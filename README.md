# turbo-downloader

Fastest file downloader for Node.js, using "by all means" downloading principle. Your file will be downloaded even in the worst conditions.

Features:
- Download using multiple connections
- Aborting at any stage
- Resuming after fails or application crashes
- Smart retry on fail
- Supports http/https
- Supports http redirects
- Usable on vanilla nodejs, electron, nwjs
- TypeScript typings

## Install

```
$ npm install --save turbo-downloader
```

## Usage

```javascript
import TurboDownloader from 'turbo-downloader';

const downloader = new TurboDownloader({
    url: 'https://example.com/my_file',
    destFile: '/some/path/to/save',
    chunkSize: 16 * 1024 * 1024, // Size of chunk (default 16MB)
    concurrency: 8, // Number of connections (default 4)
    retryCount: 10, // Number of downloading retries of each chunk (default 10)
    canBeResumed: true, // If true, you can resume download next time if current download failed (downloader save .turbodownload file near destination file)
    transformStream: (stream: stream.Readable) => stream.Readable // Transform input data (decrypt, for example)
});

downloader
    .download((downloaded, total) =>{
        console.log(`Downloaded ${downloaded} of ${total}`);
    })
    .then(() => console.log('Done'));

// Abort downloading
downloader.abort(true /* if true, you can resume downloading next time (downloader save .turbodownload file near destination file) */);

```

## Events

TurboDownloader class implements EventEmitter interface with next events:

```
  downloadStarted: (url: string, destination: string) => void,
  downloadFinished: (url: string, destination: string) => void,
  downloadError: (url: string, destination: string) => void,
  chunkDownloadStarted: (chunk: DownloadingChunk, attemptNumber: number) => void,
  chunkDownloadProgress: (chunk: DownloadingChunk) => void,
  chunkDownloadFinished: (chunk: DownloadingChunk, attemptNumber: number) => void,
  chunkDownloadError: (chunk: DownloadingChunk, attemptNumber: number, error: any) => void,
  planReady: (plan: DownloadingPlan) => void,
  aborted: () => void,
  reservingSpaceStarted: (size: number) => void,
  reservingSpaceFinished: (size: number) => void,
```

Example:

```typescript
const downloader = new TurboDownloader({
    url: 'https://example.com/my_file',
    destFile: '/some/path/to/save',
    chunkSize: 16 * 1024 * 1024, // Size of chunk (default 16MB)
    concurrency: 8, // Number of connections (default 4)
    retryCount: 10, // Number of downloading retries of each chunk (default 10)
    canBeResumed: true, // If true, you can resume download next time if current download failed (downloader save .turbodownload file near destination file)
    transformStream: (stream: stream.Readable) => stream.Readable // Transform input data (decrypt, for example)
});

downloader.on('chunkDownloadStarted', (chunk) => {
  console.log('Start chunk downloading', chunk.disposition);
});

await downloader.download();
```

## Versions

### 1.3.0

#### Improvements

Move to 'node:fs/promises' API


### 1.2.0

#### New features

1. Added events

### 1.1.0

#### New features

1. By passing transformStream option you can transform input data on the fly (see tests for examples)

#### Improvements
1. All disk writes are made asynchronous
2. Downloading plan file is not written if it is not necessary (canBeResumed = false)
