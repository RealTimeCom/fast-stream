## Fast Stream

**Fast Stream HTTP Server**

```sh
$ npm install fast-stream
```
Simple server configuration `config`, serve all requests with `200` OK.
```js
const http = require('fast-stream');
const config = {
    '*': { /*host name "*" <for all>, "cb" is the callback function*/
        404: cb => cb('<html><body><h3>Hello World!</h3></body></html>', null, 200)
    }
};
require('net').createServer(
    socket => socket.pipe(new http(config)).pipe(socket)
).listen(80);
```
Sample `config` for files or readable streams.
```js
const http = require('fast-stream'), fs = require('fs');
const config = {
    '*': {
        GET: { /*method GET*/
            '/favicon.ico': cb => cb({
                src: '/dir/favicon.ico' /*source: file path*/
            }, { /*additional header*/
                'Content-Type': http.type['ico']
            }),
            '/vid.mp4': cb => cb({
                src: fs.createReadStream('/dir/vid.mp4'), /*source: readable stream*/
                length: 31491130 /*length (data size) required for readable stream*/
            }, { /*additional headers*/
                'Content-Type': http.type['mp4'],
                'Content-Disposition': 'inline', /*display in browser*/
                'Content-Duration': 171, /*required for web video player*/
                'X-Content-Duration': 171  /*video duration in seconds*/
            })
        }
    }
};
```
Function `host` arguments `cb`, `req` and `this` bind.
```js
const config = {
    'localhost:80': { /*hostname "localhost" port "80"*/
        POST: { /*method POST*/
            '/index.html': function host(cb, req) {
                cb('<html><body><h3>' + this.remoteAddress + '</h3><code>' + JSON.stringify(req) + '</code></body></html>');
            }
        }
    }
};
```
### host (cb, req) `host function`
* `cb` Function - callback function, see bellow
* `req` Object - request, see bellow
* `this` Bind Object - pipe readable stream

### cb (data, headers, code) `callback function`
* `data` String|Buffer|Object - response, for `Object` see bellow
* `headers` Object - optional, default null
* `code` Number - optional, http status, default 200

#### data `Object response`
* `src` String|Object - `String` file path or `Object` readable stream
* `length` Number - data size, required for `src` `Object` readable stream

#### req `Object request`
* `path` String
* `query` Object
* `host` String
* `hostname` String
* `port` Number
* `attach` Object - when `req.request.method` is String:`POST`, see bellow
* `request` Object - { `method`: String, `uri`: String, `protocol`: String }
* `header` Object - { `list`: Array, `hostname`: String, `port`: Number, `length`: Number, `connection`: String, `type`: String, `boundary`: String, `etag`: String, `modified`: String, `range`: String }

#### req.attach `Object attach`
* when `req.header.type` is String:`urlencoded` - Object `querystring`
* when `req.header.type` is String:`multipart` - Object { query: Object `querystring`, files: Array Object { name: String, data: Buffer } }

--------------------------------------------------------
**Fast Stream** is licensed under the MIT license. See the included `LICENSE` file for more details.
