## Fast Stream
[![NPM](https://nodei.co/npm/fast-stream.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/fast-stream/)

[![Build Status](https://travis-ci.org/RealTimeCom/fast-stream.svg?branch=master)](http://travis-ci.org/RealTimeCom/fast-stream)
[![dependencies](https://david-dm.org/RealTimeCom/fast-stream.svg)](https://david-dm.org/RealTimeCom/fast-stream)

**Fast Stream HTTP Server**

```sh
$ npm install fast-stream
```
Simple server configuration `config`, serve all requests with `200` OK.
```js
const http = require('fast-stream');
const config = {
    '*': { // host name "*" <for all>, "cb" is the callback function
        404: cb => cb('<html><body><h3>Hello World!</h3></body></html>', null, 200)
    }
};
require('net').createServer( // or require('tls') for HTTPS / SSL
    socket => socket.pipe(new http(config)).pipe(socket)
).listen(80); // or 443 for HTTPS / SSL
```
Sample `config` for files or readable streams.
```js
const fs = require('fs');
const config = {
    '*': {
        GET: { // method GET
            '/favicon.ico': cb => cb({
                src: '/dir/favicon.ico' // source: file path
            }, { // additional header
                'Content-Type': http.type.ico
            }),
            '/vid.mp4': cb => cb({
                src: fs.createReadStream('/dir/vid.mp4') // source: readable Stream
            }, { // additional headers
                'Content-Type': http.type['mp4'],
                'Content-Disposition': 'inline', // display in browser
                'Content-Duration': 171, // required for web video player
                'X-Content-Duration': 171  // video duration in seconds
            })
        }
    }
};
```
Function `host` arguments `cb`, `req` and `this` bind example.
```js
const config = {
    'localhost:80': { // hostname "localhost" port "80"
        GET: { // URL: http://localhost/
            '/': cb => cb('<html><body>' + // attach small files, or remove JSON.stringify(req), see below
                '<form action="/attach.html" method="post" enctype="multipart/form-data">' +
                '<input type="text" name="t1"><input type="text" name="t2"><input type="text" name="t2">' +
                '<input type="file" name="f1"><input type="file" name="f2"><input type="file" name="f2">' +
                '<input type="submit" value="Submit">' +
                '</form>' +
                '</body></html>')
        },
        POST: { // URL: http://localhost/attach.html (method POST only)
            '/attach.html': function host(cb, req) {
                cb('<html><body>' + // client IP address
                    '<h3>' + this._readableState.pipes.remoteAddress + '</h3>' +
                    '<code>' + JSON.stringify(req) + '</code>' +
                    '</body></html>'); // default 'Content-Type' is 'text/html' utf8
            }
        }
    },
    '127.0.0.1:80': { // another host
        GET: { // URL: http://127.0.0.1/
            '/': cb => cb('Request from 127.0.0.1:80', { 'Content-Type': http.type.txt })
        }
    }
};
```
### `http (config, options)` class
* `config` Object - host functions list, see the examples above
* `options` Object - see below

### `host (cb, req)` host function
* `cb` Function - callback function, see below
* `req` Object - request, see below
* `this` Bind Object - this Stream

### `cb (data, headers, code)` callback function
* `data` String|Buffer|Object - response, for `Object` see below
* `headers` Object - optional, default null
* `code` Number - optional, http status, default 200

### `data` Object response
* `src` String|Object - `String` file path or `Object` readable stream
* `length` Number - optional, data size, required for range bytes when `src` is readable stream

### `req` Object request
* `path` String
* `query` Object - header `querystring`
* `host` String
* `hostname` String
* `port` Number
* `attach` Object - when `req.request.method` is `POST`, see below
* `request` Object - { `method`: String, `uri`: String, `protocol`: String }
* `header` Object - { `list`: Array, `hostname`: String, `port`: Number, `length`: Number, `connection`: String, `type`: String, `boundary`: String, `etag`: String, `modified`: String, `range`: String }

### `req.attach` Object attach
* when `req.header.type` is `urlencoded` - Object `querystring` from `POST` body
* when `req.header.type` is `multipart` - Object { query: Object `querystring`, files: Array Object { name: String, data: Buffer } }

### `options` Object http class argument
* `limit` Number - anti memory overhead, request data maximum size, default `5e8` ~500MB, for big data/files, consider to increase this value
* `ranges` Boolean - accept ranges request, default `true`
* `error` String - custom error name event, default `httpError`
* `name` String - Server name/version, default `fast-stream/2.1`, `null` - to disable
* `cache` Boolean - client cache, send/verify "Last-Modified" and/or "ETag" header, default `true`
* `closeOnError` Boolean - close connection on status `code` >= `400`, default `false`, don't close
* `chunked` Number - if body response size is greater than this value, send "Transfer-Encoding: chunked", default `2e7` ~20MB, `0` - to disable

--------------------------------------------------------
**Fast Stream** is licensed under the MIT license. See the included `LICENSE` file for more details.
