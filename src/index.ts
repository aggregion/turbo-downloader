import axios, {AxiosRequestConfig, ResponseType} from 'axios';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import {strict as assert} from 'assert';
import PromisePool from '@supercharge/promise-pool';
import * as http from 'http';
import * as https from 'https';
import * as stream from 'stream';
import TypedEmitter from 'typed-emitter';
import EventEmitter from 'events';

const DEFAULT_CHUNK_SIZE = 16 * 1024 * 1024;
const MIN_CHUNK_SIZE = 1024;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RETRY_COUNT = 10;

export interface TurboDownloaderOptions {
  url: string;
  destFile: string;
  chunkSize: number;
  concurrency: number;
  retryCount: number;
  canBeResumed: boolean;
  adapter: any;
  fillFileByte: number;
  transformStream?: (stream: stream.Readable) => stream.Readable;
}

interface TurboDownloaderConstructorOptions {
  url: string;
  destFile: string;
  chunkSize?: number;
  concurrency?: number;
  retryCount?: number;
  canBeResumed?: boolean;
  adapter?: any;
  fillFileByte?: number;
  transformStream?: (stream: stream.Readable) => stream.Readable;
}

interface DownloadingChunk {
  disposition: number;
  size: number;
  downloaded: number;
}

interface DownloadUrlOptions {
  size: number;
  acceptRanges: boolean;
}

type DownloadingPlan = DownloadUrlOptions & {
  chunks: DownloadingChunk[];
};

type Events = {
  downloadStarted: (url: string, destination: string) => void;
  downloadFinished: (url: string, destination: string) => void;
  downloadError: (url: string, destination: string) => void;
  chunkDownloadStarted: (
    chunk: DownloadingChunk,
    attemptNumber: number,
  ) => void;
  chunkDownloadProgress: (chunk: DownloadingChunk) => void;
  chunkDownloadFinished: (
    chunk: DownloadingChunk,
    attemptNumber: number,
  ) => void;
  chunkDownloadError: (
    chunk: DownloadingChunk,
    attemptNumber: number,
    error: any,
  ) => void;
  planReady: (plan: DownloadingPlan) => void;
  aborted: () => void;
  reservingSpaceStarted: (size: number) => void;
  reservingSpaceFinished: (size: number) => void;
};

export default class TurboDownloader extends (EventEmitter as unknown as new () => TypedEmitter<Events>) {
  protected options: TurboDownloaderOptions;
  protected started = false;
  protected aborted = false;
  protected abortSaveProgress = false;
  protected abortHandlers: (() => void)[] = [];

  private httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 1024,
    timeout: 30000,
  });

  private httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 1024,
    timeout: 30000,
  });

  constructor(options: TurboDownloaderConstructorOptions) {
    super();
    this.options = {
      ...options,
      chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE,
      concurrency: options.concurrency || DEFAULT_CONCURRENCY,
      retryCount: options.retryCount || DEFAULT_RETRY_COUNT,
      canBeResumed: options.canBeResumed || true,
      adapter: options.adapter,
      fillFileByte: options.fillFileByte || 0,
      transformStream: options.transformStream,
    };
    assert(
      this.options.chunkSize >= MIN_CHUNK_SIZE,
      `Chunk size must be ${MIN_CHUNK_SIZE} or greater`,
    );
    assert(this.options.concurrency >= 1, 'Concurrency must be 1 or greater');
    assert(this.options.retryCount >= 0, 'retryCount must be 0 or greater');
  }

  async download(
    progressCallback?: (
      downloaded: number,
      total: number,
      plan: DownloadingPlan,
    ) => void,
  ) {
    if (this.started) {
      throw new Error('Already started');
    }
    this.started = true;
    this.emit('downloadStarted', this.options.url, this.options.destFile);
    const plan = await this.getDownloadingPlan();
    this.emit('planReady', plan);
    const chunksToDownload = plan.chunks.filter(
      (chunk) => chunk.downloaded < chunk.size,
    );
    try {
      await PromisePool.for(chunksToDownload)
        .withConcurrency(this.options.concurrency)
        .handleError(async (error) => {
          throw error;
        })
        .process(async (chunk) => {
          if (this.aborted) {
            return;
          }
          let retries = 0;
          let lastError;
          while (retries <= this.options.retryCount) {
            try {
              this.emit('chunkDownloadStarted', chunk, retries);
              await this.downloadChunk(
                chunk,
                (newChunk) => {
                  chunk.downloaded = newChunk.downloaded;
                  if (this.options.canBeResumed) {
                    this.saveDownloadingPlanToDisk(plan);
                  }
                  if (plan.size > 0 && progressCallback) {
                    const downloaded = plan.chunks.reduce(
                      (sum, chunk) => sum + chunk.downloaded,
                      0,
                    );
                    progressCallback(downloaded, plan.size, plan);
                  }
                },
                (abort) => this.abortHandlers.push(abort),
              );
              this.emit('chunkDownloadFinished', chunk, retries);
              return;
            } catch (e) {
              this.emit('chunkDownloadError', chunk, retries, e);
              lastError = e;
              retries++;
              await new Promise((resolve) => {
                setTimeout(resolve, 1000 * Math.pow(retries, 2));
              });
            }
          }
          throw lastError;
        });
    } catch (e) {
      this.emit('downloadError', this.options.url, this.options.destFile);
      if (!this.options.canBeResumed) {
        await this.deletePlanFromDisk();
      }
      throw e;
    }
    if (!this.abortSaveProgress) {
      await this.deletePlanFromDisk();
      if (this.aborted) {
        await fsp.unlink(this.options.destFile);
      }
    }
  }

  async abort(saveProgress = false) {
    if (!this.started) {
      return;
    }
    this.aborted = true;
    this.emit('aborted');
    this.abortSaveProgress = saveProgress;
    for (const handler of this.abortHandlers) {
      handler();
    }
  }

  private async deletePlanFromDisk() {
    const fileName = this.getPlanFileName();
    if (fs.existsSync(fileName)) {
      await fsp.unlink(fileName);
    }
  }

  private async downloadChunk(
    chunk: DownloadingChunk,
    progressCallback: (chunk: DownloadingChunk) => void,
    abortHandler: (abort: () => void) => void,
  ) {
    const start = chunk.size > 0 ? chunk.disposition + chunk.downloaded : 0;
    const sizeLeft = chunk.size > 0 ? chunk.size - chunk.downloaded : -1;
    const cancelTokenSource = axios.CancelToken.source();
    const options: AxiosRequestConfig = {
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      responseType: <ResponseType>'stream',
      cancelToken: cancelTokenSource.token,
      adapter: this.options.adapter,
    };
    if (sizeLeft > 0) {
      options.headers = {range: `bytes=${start}-${start + sizeLeft - 1}`};
    }
    const response = await axios.get(this.options.url, options);
    const responseStream = response.data;
    const stream = this.options.transformStream
      ? this.options.transformStream(responseStream)
      : responseStream;
    const fd = await fsp.open(this.options.destFile, 'r+');
    const fileStream = fd.createWriteStream({start: chunk.disposition});
    await new Promise<void>((resolve, reject) => {
      abortHandler(() => {
        cancelTokenSource.cancel();
      });
      stream.on('data', async (buffer: Buffer) => {
        chunk.downloaded += buffer.length;
        this.emit('chunkDownloadProgress', chunk);
        progressCallback(chunk);
      });
      stream.on('error', (err: any) => {
        reject(err);
      });
      stream.pipe(fileStream);
      fileStream.on('close', () => {
        resolve();
      });
    });
  }

  private async getDownloadingPlan() {
    const options = await this.getOptions();
    return (
      (await this.readDownloadingPlanFromDisk(options)) ||
      (await this.createDownloadingPlan(options))
    );
  }

  private getPlanFileName() {
    return `${this.options.destFile}.turbodownload`;
  }

  private async readDownloadingPlanFromDisk(options: DownloadUrlOptions) {
    const fileName = this.getPlanFileName();
    if (fs.existsSync(fileName)) {
      const data = await fsp.readFile(this.getPlanFileName(), 'utf8');
      try {
        const plan = JSON.parse(data) as DownloadingPlan;
        if (
          plan.acceptRanges === options.acceptRanges &&
          plan.size === options.size
        ) {
          return plan;
        }
      } catch (e) {
      }
    }
    return null;
  }

  private saveDownloadingPlanToDisk(plan: DownloadingPlan) {
    fs.writeFileSync(
      this.getPlanFileName(),
      JSON.stringify(plan, null, 2),
      'utf8',
    );
  }

  private async createDownloadingPlan(options: DownloadUrlOptions) {
    const plan: DownloadingPlan = {
      ...options,
      chunks: [],
    };
    if (plan.acceptRanges && plan.size && plan.size > 0) {
      const chunkSize = this.options.chunkSize;
      const chunksCount = Math.ceil(plan.size / chunkSize);
      for (let i = 0; i < chunksCount; i++) {
        const size =
          i === chunksCount - 1 ? plan.size - chunkSize * i : chunkSize;
        plan.chunks.push({
          size,
          disposition: i * chunkSize,
          downloaded: 0,
        });
      }
    } else {
      plan.chunks.push({
        size: plan.size,
        disposition: 0,
        downloaded: 0,
      });
    }
    this.emit('reservingSpaceStarted', options.size);
    await this.reserveSpace(options);
    this.emit('reservingSpaceFinished', options.size);
    return plan;
  }

  private async getOptions() {
    const reqOptions = {
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      adapter: this.options.adapter,
    };
    const response = await axios.head(this.options.url, reqOptions);
    const acceptRanges = response.headers['accept-ranges'] === 'bytes';
    const size = response.headers['content-length']
      ? parseInt(response.headers['content-length'])
      : -1;
    return {
      acceptRanges,
      size,
    };
  }

  private async reserveSpace(options: DownloadUrlOptions) {
    const fd = await fsp.open(this.options.destFile, 'w');
    if (options.size > 0) {
      const buffer = Buffer.alloc(DEFAULT_CHUNK_SIZE).fill(
        this.options.fillFileByte,
      );
      let wrote = 0;
      while (wrote < options.size) {
        const sz = Math.min(buffer.length, options.size - wrote);
        if (sz > 0) {
          await fd.write(buffer, 0, sz);
          wrote += sz;
        }
      }
    }
    await fd.close();
  }
}
