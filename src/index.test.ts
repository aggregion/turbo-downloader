import * as fs from 'fs';
import * as crypto from 'crypto';
import TurboDownloader from './index';
import temp from 'temp';

const fileForTesting = 'http://speedtest.ftp.otenet.gr/files/test100k.db';
const fileMd5 = '4c6426ac7ef186464ecbb0d81cbfcb1e';
const fileSize = 102400;

const file10mb = 'http://speedtest.ftp.otenet.gr/files/test10Mb.db';
// const file10mbSize = 10485760;
const file10mbMd5 = 'f1c9645dbc14efddc7d8a322685f26eb';

//const file10gb = 'http://speedtest-sgp1.digitalocean.com/5gb.test';

const checkMd5 = (fileName: string, hash: string) => {
  const data = fs.readFileSync(fileName);
  const md5 = crypto.createHash('md5');
  md5.update(data);
  return md5.digest('hex') === hash;
};

test.skip('should be no loss of performance with transform stream', async () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  let dSum = 0;
  const testsCount = 5;
  for (let i = 0; i < testsCount; i++) {
    const tempFile1 = '/dev/null';
    const tempFile2 = temp.path({ suffix: '.png' });
    const downloader1 = new TurboDownloader({
      url: file10mb,
      destFile: tempFile1,
      canBeResumed: false,
      chunkSize: 1024 * 1024,
      fillFileByte: 1,
    });
    const downloader2 = new TurboDownloader({
      url: file10mb,
      destFile: tempFile2,
      canBeResumed: false,
      chunkSize: 1024 * 1024,
      transformStream: (stream) => {
        const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
        return stream.pipe(cipher);
      },
      fillFileByte: 1,
    });
    try {
      let startTime = new Date().getTime();
      await downloader1.download();
      const d1Time = new Date().getTime() - startTime;
      try {
        startTime = new Date().getTime();
        await downloader2.download();
        const d2Time = new Date().getTime() - startTime;
        const d = (Math.abs(d2Time - d1Time) * 2) / (d1Time + d2Time);
        dSum += d;
        console.log(d1Time, d2Time);
      } finally {
        fs.unlinkSync(tempFile2);
      }
    } finally {
      fs.unlinkSync(tempFile1);
    }
  }
  // console.log(dSum / testsCount);
  expect(dSum / testsCount).toBeLessThan(0.2);
}, 300000);

test('should correctly work with transform stream', async () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const tempFile = temp.path({ suffix: '.png' });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
    chunkSize: fileSize,
    transformStream: (stream) => {
      const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
      return stream.pipe(cipher);
    },
    fillFileByte: 1,
  });
  try {
    await downloader.download();
    expect(fs.lstatSync(tempFile).size).toEqual(fileSize);
    const encryptedData = fs.readFileSync(tempFile);
    const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
    const decryptedData = decipher.update(encryptedData);
    const md5 = crypto.createHash('md5');
    md5.update(decryptedData);
    expect(md5.digest('hex')).toBe(fileMd5);
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test('should download file correctly', async () => {
  const tempFile = temp.path({ suffix: '.png' });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
    chunkSize: 4096,
    fillFileByte: 1,
  });
  try {
    await downloader.download();
    expect(fs.lstatSync(tempFile).size).toEqual(fileSize);
    expect(checkMd5(tempFile, fileMd5)).toBeTruthy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test('should remove plan file', async () => {
  const tempFile = temp.path({ suffix: '.png' });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
  });
  try {
    await downloader.download();
    expect(fs.existsSync(`${tempFile}.turbodownload`)).toBeFalsy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test('should download file correctly using chunks', async () => {
  const tempFile = temp.path({ suffix: '.png' });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
    chunkSize: 32000,
    fillFileByte: 1,
  });
  try {
    await downloader.download();
    expect(fs.lstatSync(tempFile).size).toEqual(fileSize);
    expect(checkMd5(tempFile, fileMd5)).toBeTruthy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test('should correctly return progress', async () => {
  const tempFile = temp.path({ suffix: '.png' });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
    chunkSize: 32000,
    fillFileByte: 1,
  });
  try {
    let lastDownloaded = 0;
    await downloader.download((downloaded, total) => {
      expect(total).toEqual(fileSize);
      expect(downloaded).toBeLessThanOrEqual(fileSize);
      expect(downloaded).toBeGreaterThanOrEqual(lastDownloaded);
      lastDownloaded = downloaded;
    });
    expect(checkMd5(tempFile, fileMd5)).toBeTruthy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test('should correctly aborting', async () => {
  const tempFile = temp.path({ suffix: '.png' });
  const downloader = new TurboDownloader({
    url: file10mb,
    destFile: tempFile,
    chunkSize: 16 * 1024,
    concurrency: 8,
    fillFileByte: 1,
  });
  try {
    await downloader.download((downloaded) => {
      if (downloaded >= 16000) {
        downloader.abort(true);
      }
    });
    expect(checkMd5(tempFile, file10mbMd5)).toBeFalsy();
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

test('should correctly resume downloading', async () => {
  const tempFile = temp.path({ suffix: '.png' });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
    chunkSize: 4096,
    concurrency: 8,
    fillFileByte: 1,
  });
  try {
    await downloader.download((downloaded) => {
      if (downloaded >= 16000) {
        downloader.abort(true);
      }
    });
    expect(checkMd5(tempFile, fileMd5)).toBeFalsy();
    const downloader2 = new TurboDownloader({
      url: fileForTesting,
      destFile: tempFile,
      chunkSize: 4096,
      concurrency: 8,
      fillFileByte: 1,
    });
    await downloader2.download();
    expect(checkMd5(tempFile, fileMd5)).toBeTruthy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});
