import * as fs from "fs";
import * as crypto from "crypto";
import TurboDownloader from "./index";
import temp from "temp";

const fileForTesting =
  "https://storage.aggregion.com/api/files/fb9ba718258d7e9b0e7bd6712c11557c6a21df8d5bad444d558fbd5f19b12114/shared/data";
const fileMd5 = "0475eab3e8c07e3b084b2db500437f2e";
const fileSize = 80185;

const checkMd5 = (fileName: string, hash: string) => {
  const data = fs.readFileSync(fileName);
  const md5 = crypto.createHash("md5");
  md5.update(data);
  return md5.digest("hex") === hash;
};

test("should download file correctly", async () => {
  const tempFile = temp.path({ suffix: ".png" });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
  });
  try {
    await downloader.download();
    expect(checkMd5(tempFile, fileMd5)).toBeTruthy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test("should remove plan file", async () => {
  const tempFile = temp.path({ suffix: ".png" });
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

test("should download file correctly using chunks", async () => {
  const tempFile = temp.path({ suffix: ".png" });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
    chunkSize: 32000,
  });
  try {
    await downloader.download();
    expect(checkMd5(tempFile, fileMd5)).toBeTruthy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test("should correctly return progress", async () => {
  const tempFile = temp.path({ suffix: ".png" });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
    chunkSize: 32000,
  });
  try {
    let lastDownloaded = 0;
    await downloader.download((downloaded, total) => {
      expect(total).toEqual(fileSize);
      expect(downloaded).toBeLessThanOrEqual(fileSize);
      expect(downloaded).toBeGreaterThan(lastDownloaded);
      lastDownloaded = downloaded;
    });
    expect(checkMd5(tempFile, fileMd5)).toBeTruthy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test("should correctly aborting", async () => {
  const tempFile = temp.path({ suffix: ".png" });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
    chunkSize: 1024,
    concurrency: 8,
  });
  try {
    await downloader.download((downloaded) => {
      if (downloaded >= 16000) {
        downloader.abort();
      }
    });
    expect(checkMd5(tempFile, fileMd5)).toBeFalsy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});

test("should correctly resume downloading", async () => {
  const tempFile = temp.path({ suffix: ".png" });
  const downloader = new TurboDownloader({
    url: fileForTesting,
    destFile: tempFile,
    chunkSize: 4096,
    concurrency: 8,
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
    });
    await downloader2.download((downloaded) => {
      expect(downloaded).toBeGreaterThan(16000);
    });
    expect(checkMd5(tempFile, fileMd5)).toBeTruthy();
  } finally {
    fs.unlinkSync(tempFile);
  }
});
