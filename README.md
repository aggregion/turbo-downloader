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
    canBeResumed: true // If true, you can resume download next time if current download failed (downloader save .turbodownload file near destination file)
});

downloader
    .download((downloaded, total) =>{
        console.log(`Downloaded ${downloaded} of ${total}`);
    })
    .then(() => console.log('Done'));

// Abort downloading
downloader.abort(true /* if true, you can resume downloading next time (downloader save .turbodownload file near destination file) */);

```
