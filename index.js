/* SOURCE FILE - Copyright (c) 2017 fast-stream - Tanase Laurentiu Iulian - https://github.com/RealTimeCom/fast-stream */
'use strict';

const Transform = require('stream').Transform,
    parse = require('url').parse,
    qs = require('querystring').parse,
    path = require('path'),
    fs = require('fs'),
    crypto = require('crypto'),
    bs = require('bytes-stream'),
    cs = require('chunks-stream');

class http extends Transform {
    constructor(f, opt) {
        super();
        if (typeof this._readableState.pipes !== 'object') { throw new Error('no readable pipe found'); }
        if (typeof opt !== 'object') { opt = {}; }
        this.f = f; // config functions
        this.l = 'limit' in opt ? parseInt(opt.limit) : 1e8; // limit bytes, client request header+body maximum bytes, anti memory overhead
        this.r = 'ranges' in opt ? Boolean(opt.ranges) : true; // accept ranges request, default true
        this.e = 'error' in opt ? opt.error + '' : 'httpError'; // custom error name event | "error" name will throw the error and exit the process
        this.n = 'name' in opt ? opt.name === null ? undefined : opt.name + '' : 'fast-stream/1.2'; // Server name/version
        this.t = 'cache' in opt ? Boolean(opt.cache) : true; // cache, default enabled, send/verify "Last-Modified" and/or "ETag" header
        this.i = 'closeOnError' in opt ? Boolean(opt.closeOnError) : true; // close connection on error when code>=400, default true for safety, but less speed
        this.b = 'chunked' in opt ? parseInt(opt.chunked) : 2e7; // chunk bytes, 0-disable
        if (this.b) { // convert chunk size into hex number
            this.g = Buffer.from(this.b.toString(16));
        }
        this.h = true; // data is header?
        this.z = Buffer.allocUnsafeSlow(0); // create an un-pooled empty buffer
        this.c = this.z; // init empty cache buffer
        this.s = {}; // data header request
        this.w = true; //connection is open?
    }
}

http.prototype._transform = function(chunk, enc, cb) {
    if (this.c.length + chunk.length > this.l) {
        this.error(413);
    } else {
        this.c = Buffer.concat([this.c, chunk]); // append chunk to cache
        if (this.h) { // chunk is header
            this.s = {}; // init/reset this.s
            let l = this.c.length,
                i = this.c.indexOf(http.L); // search for separator
            if (i !== -1) { // separator is found
                let request, header, h = this.c.slice(0, i),
                    j = h.indexOf(http.N);
                if (j === -1) { // one header line, HTTP/1.0
                    this.s['request'] = http.request(h);
                    this.s['header'] = http.header(this.z);
                } else { // multiple header lines
                    this.s['request'] = http.request(h.slice(0, j));
                    this.s['header'] = http.header(h.slice(j + http.N.length));
                }
                if (this.s.request.method === undefined || this.s.request.uri === undefined || this.s.request.protocol === undefined) {
                    this.error(400);
                } else if (!this.s.header.hostname && this.s.request.protocol === 'HTTP/1.1') { // "Host" header required for HTTP/1.1
                    this.error(400);
                } else {
                    if (!this.s.header.hostname) {
                        this.s.header['hostname'] = '*';
                    }
                    let p = parse(this.s.request.uri, true);
                    if (!p.hostname) {
                        p['hostname'] = '*';
                    }
                    this.s['path'] = p.pathname;
                    this.s['query'] = p.query;
                    // resolve port
                    if (this.s.header.port) {
                        this.s['port'] = this.s.header.port;
                    } else if (p.port) {
                        this.s['port'] = p.port;
                    } else if ('pipes' in this._readableState && 'localPort' in this._readableState.pipes) {
                        this.s['port'] = this._readableState.pipes.localPort;
                    } else { // set default port 80
                        this.s['port'] = 80;
                    }
                    this.s['hostname'] = this.s.header.hostname === '*' ? p.hostname : this.s.header.hostname;
                    this.s['host'] = this.s['hostname'] + ':' + this.s['port'];
                    // resolve host
                    if (!(this.s.host in this.f)) {
                        this.s.host = this.s['hostname'];
                        if (!(this.s.host in this.f)) {
                            this.s.host = '*:' + this.s['port'];
                            if (!(this.s.host in this.f)) {
                                this.s.host = '*';
                            }
                        }
                    }
                    if (this.s.host in this.f) {
                        if (this.s.request.method === 'HEAD' || this.s.request.method === 'GET') { // HEAD is same as GET, but only header data is sent
                            this.c = this.c.slice(i + http.L.length); // cache remaining bytes, for next request
                            this.fc('GET');
                        } else if (this.s.request.method === 'OPTIONS') {
                            this.c = this.c.slice(i + http.L.length); // cache remaining bytes, for next request
                            if (this.s.path === '*') { // request methods supported by server
                                this.send(this.s, 'GET, HEAD, POST', {
                                    'Content-Type': http.type.txt,
                                    Allow: 'GET, HEAD, POST'
                                });
                            } else { // request methods supported by pathname
                                let c = [];
                                if (typeof this.f[this.s.host][404] === 'function') {
                                    c.push('GET', 'HEAD', 'POST');
                                } else {
                                    if ('GET' in this.f[this.s.host] && typeof this.f[this.s.host]['GET'][this.s.path] === 'function') {
                                        c.push('GET', 'HEAD'); // HEAD is same as GET
                                    }
                                    if ('POST' in this.f[this.s.host] && typeof this.f[this.s.host]['POST'][this.s.path] === 'function') {
                                        c.push('POST');
                                    }
                                }
                                if (c.length === 0) {
                                    this.error(405);
                                } else {
                                    this.send(this.s, c.join(', '), {
                                        'Content-Type': http.type.txt,
                                        Allow: c.join(', ')
                                    });
                                }
                            }
                        } else if (this.s.request.method === 'POST') {
                            if ('length' in this.s.header && this.s.header.length) { // "Content-Length" header required for POST
                                if (this.s.header.length > this.l) {
                                    this.error(413); // "Content-Length" exceed the limit
                                } else if (this.s.header.type === undefined) {
                                    this.error(400); // "Content-Type" header required for POST
                                } else if (this.s.header.type === 'multipart' && this.s.header.boundary === undefined) {
                                    this.error(400); // no boundary found in multipart
                                }
                                else {
                                    let body = this.c.slice(i + http.L.length);
                                    if (body.length >= this.s.header.length) { // body complete
                                        if (body.length > this.s.header.length) {
                                            body = body.slice(0, this.s.header.length);
                                            this.c = body.slice(this.s.header.length); // cache remaining bytes, for next request
                                        } else { // empty cache
                                            this.c = this.z;
                                        }
                                        this.s['attach'] = this.s.header.type === 'multipart' ? http.parse(body, this.s.header.boundary) : qs(body.toString());
                                        this.fc('POST');
                                    } else { // need more bytes for body
                                        this.h = false; // next chunk is body
                                        this.c = body; // save body part to cache
                                    }
                                }
                            } else {
                                this.error(411);
                            }
                        } else if (this.s.request.method === 'PUT' || this.s.request.method === 'DELETE' || this.s.request.method === 'TRACE' || this.s.request.method === 'CONNECT') {
                            //  todo
                            this.c = this.c.slice(i + http.L.length); // cache remaining bytes, for next request
                            this.error(501);
                        } else {
                            this.c = this.c.slice(i + http.L.length); // cache remaining bytes, for next request
                            this.error(405);
                        }
                    } else {
                        this.c = this.c.slice(i + http.L.length); // cache remaining bytes, for next request
                        this.error(404);
                    }
                }
            } // need more bytes for header
        } else { // chunk is body
            if (this.c.length >= this.s.header.length) { // body complete
                let body;
                if (this.c.length > this.s.header.length) {
                    body = this.c.slice(0, this.s.header.length);
                    this.c = this.c.slice(this.s.header.length); // cache remaining bytes, for next request
                } else {
                    body = this.c;
                    this.c = this.z; // empty cache
                }
                this.s['attach'] = this.s.header.type === 'multipart' ? http.parse(body, this.s.header.boundary) : qs(body.toString());
                this.h = true; // next chunk is header
                this.fc('POST');
            } // need more bytes for body
        }
    }
    cb();
};
http.prototype._flush = function(cb) {
    this.w = false;
    cb();
};

http.prototype.fc = function(method) {
    let f = undefined; // local function call
    if (method in this.f[this.s.host] && typeof this.f[this.s.host][method][this.s.path] === 'function') {
        f = this.f[this.s.host][method][this.s.path];
    } else if (typeof this.f[this.s.host][404] === 'function') {
        f = this.f[this.s.host][404];
    }
    if (f === undefined) { // function call not found
        this.error(404);
    } else {
        this._readableState.pipes.pause(); // pause socket until server response back
        f.bind(this)(this.send.bind(this, this.s), this.s);
    }
};

http.prototype.error = function(code) {
    this._readableState.pipes.pause(); // pause socket until server response back
    this.send(this.s, http.code[code], {
        'Content-Type': http.type.txt
    }, code);
};

http.prototype.fileLength = function(s, body, header, code) {
    body.src = path.normalize(body.src.trim());
    if (!(body.src === '.' || body.src === '..')) {
        let t = this;
        fs.lstat(body.src, function(e, d) {
            if (e) {
                t.emit(t.e, new Error(e));
                t.send(s, http.code[404], {
                    'Content-Type': http.type.txt
                }, 404);
            } else {
                if (t.t) { // cache enabled
                    if (header && typeof header === 'object') {
                        if (!('Last-Modified' in header)) {
                            header['Last-Modified'] = d.mtime.toUTCString();
                        }
                    } else {
                        header = {};
                        header['Last-Modified'] = d.mtime.toUTCString();
                    }
                }
                body.length = d.size;
                t.send(s, body, header, code);
            }
        });
    } else {
        this.send(s, http.code[404], {
            'Content-Type': http.type.txt
        }, 404);
    }
};

http.prototype.send = function(s, body, header, code) {

    if (this.w) { // connection is open?
        if (typeof body === 'object' && typeof body.src === 'string' && typeof body.length !== 'number') { // file without length
            this.fileLength(s, body, header, code); // verify file and get the length
            return; // exit
        }
        // verify http status code value
        code = code ? parseInt(code) : 200;
        if (!(code in http.code)) {
            throw new Error('invalid http status code: ' + code);
        }
        // verify header value
        if (!(header && typeof header === 'object')) {
            header = {}; // init
        }
        // make custom error message
        let src = false,
            m = s.host + ' ' + s.request.protocol + ' ' + s.request.method + ' ' + s.path;
        if (code >= 400) {
            if (this.i) { // close connection
                header['Connection'] = 'close';
            } else if (code === 413) { // force close connection
                header['Connection'] = 'close';
            }
            this.emit(this.e, new Error(code + ' ' + m)); // emit custom error event
        }
        // verify body value
        if (!Buffer.isBuffer(body)) {
            if (typeof body === 'string') {
                body = Buffer.from(body);
            } else if (http.isSource(body)) {
                src = true;
                if (!('length' in body)) {
                    body.length = -1; // don't send "Accept-Ranges" header if length=-1
                }
            } else { // convert body value
                body = Buffer.from(body + '');
            }
        }
        let cached = false,
            l = 'Content-Length' in header ? parseInt(header['Content-Length']) : body.length;

        if (this.t) { // cache enabled, compare ETag and Last-Modified values
            if (!src && !('ETag' in header)) { // ETag not found, create
                header['ETag'] = http.etag(body);
            }
            if (s.header.etag && s.header.modified && 'ETag' in header && 'Last-Modified' in header) { // verify both
                if (s.header.etag === header['ETag'] && s.header.modified === header['Last-Modified']) {
                    delete header['ETag'];
                    delete header['Last-Modified'];
                    cached = true;
                }
            } else { // verify one of
                if (s.header.etag && 'ETag' in header) {
                    if (s.header.etag === header['ETag']) {
                        delete header['ETag'];
                        cached = true;
                    }
                }
                if (s.header.modified && 'Last-Modified' in header) {
                    if (s.header.modified === header['Last-Modified']) {
                        delete header['Last-Modified'];
                        cached = true;
                    }
                }
            }
        } else { // cache disabled, delete "Last-Modified" and "ETag" header, if found
            if ('Last-Modified' in header) {
                delete header['Last-Modified'];
            }
            if ('ETag' in header) {
                delete header['ETag'];
            }
        }
        let a = [],
            range = null,
            x = s.request.protocol === 'HTTP/1.1' && s.header.connection === 'keep-alive' ? 'keep-alive' : 'close'; // can not use "keep-alive" on HTTP/1.0

        if (this.r && code === 200 && l > 0 && s.request.protocol === 'HTTP/1.1' && s.header.range) { // range request
            range = http.range(s.header.range, l);
            if ('Last-Modified' in header) { // for safety, disable client cache
                delete header['Last-Modified'];
            }
            if ('ETag' in header) { // for safety, disable client cache
                delete header['ETag'];
            }
            if (range) {
                a.push(s.request.protocol + ' ' + http.code[206]);
                header['Content-Range'] = 'bytes ' + range[0] + '-' + (range[1] - 1) + '/' + l; // set range header
                l = range[1] - range[0]; // update length
                header['Content-Length'] = l;
                if (!src) { // not stream/file
                    body = body.slice(range[0], range[1]);
                }
            } else { // not in range
                this.emit(this.e, new Error('416 ' + m)); // emit custom error event
                a.push(s.request.protocol + ' ' + http.code[416]);
                header['Content-Range'] = 'bytes */' + l;
                header['Accept-Ranges'] = 'bytes';
                l = 0; // send headers only
                if (this.i) {
                    x = 'close';
                }
            }
        } else if (cached) { // the request is cached in browser
            a.push(s.request.protocol + ' ' + http.code[304]);
        } else {
            a.push(s.request.protocol + ' ' + http.code[code]);
        }
        if (!('Content-Type' in header)) { // default "Content-Type" value text/html
            header['Content-Type'] = http.type.html;
        }
        if (!('Date' in header)) {
            header['Date'] = new Date().toUTCString();
        }
        if (!('Server' in header) && this.n) {
            header['Server'] = this.n;
        }
        if (!('Content-Length' in header) && l >= 0) {
            header['Content-Length'] = l;
        }
        if (!('Accept-Ranges' in header) && this.r && l > 0 && s.request.protocol === 'HTTP/1.1') {
            header['Accept-Ranges'] = 'bytes'; // Accept-Ranges if body length>0
        }
        header['Connection'] = x; // for safety, overwrite header Connection value

        if (s.request.method === 'HEAD' || cached || l === 0) { // send only headers
            for (let k in header) {
                a.push(k + ': ' + header[k]);
            }
            if (this.w) {
                this.push(Buffer.concat([Buffer.from(a.join(http.n)), http.L]));
                if (x === 'close') {
                    this.push(null);
                } else if (this._readableState.pipes) {
                    this._readableState.pipes.resume(); // resume socket, get more data
                }
            }
        } else {
            if (this.b && s.request.protocol === 'HTTP/1.1' && (l === -1 || l > this.b)) { // chunked
                if ('Content-Length' in header) {
                    delete header['Content-Length']; // delete "Content-Length" header when chunked enabled
                }
                header['Transfer-Encoding'] = 'chunked'; // set "Transfer-Encoding" header
                if (src) {
                    this.stream(body.src, x, a, l, header, range, this.b);
                } else {
                    console.log('chunked', this.b, range);
                    for (let k in header) {
                        a.push(k + ': ' + header[k]);
                    }
                    this.push(Buffer.concat([Buffer.from(a.join(http.n)), http.L])); // send headers

                    for (let y, i = 0; i < l; i += this.b) { // for each chunk
                        y = (l < i + this.b) ? l - i : this.b;
                        if (this.w) {
                            this.push(Buffer.concat([y === this.b ? this.g : Buffer.from(y.toString(16)), http.N, body.slice(i, i + y), http.N]));
                        } else {
                            break;
                        }
                    }
                    if (this.w) { // push end bytes
                        this.push(http.EL);
                    }
                }
            } else { // not-chunked
                if (src) {
                    this.stream(body.src, x, a, l, header, range, 0);
                } else {
                    console.log('default', range);
                    for (let k in header) {
                        a.push(k + ': ' + header[k]);
                    }
                    this.push(Buffer.concat([Buffer.from(a.join(http.n)), http.L, body]));
                }
            }
            if (!src && this.w) {
                if (x === 'close') {
                    this.push(null); // if Connection close, end pipe
                } else if (this._readableState.pipes) {
                    this._readableState.pipes.resume(); // resume socket, get more data
                }
            }
        }
    } //else, discard, connection end | new client request found
};

http.prototype.stream = function(src, x, a, l, header, range, chunked) {
    let t = this,
        f = (typeof src === 'string');
    console.log(f ? 'file' : 'stream', x, chunked, range);
    if (f) {
        src = fs.createReadStream(src, range ? { start: range[0], end: range[1] } : {});
    } else {
        if (!chunked && l === -1) { // unknown length, close connection
            x = 'close';
            header['Connection'] = x;
        }
    }
    for (let k in header) {
        a.push(k + ': ' + header[k]);
    }
    this.push(Buffer.concat([Buffer.from(a.join(http.n)), http.L])); // send headers
    src.
    on('error', function(e) {
        t.emit(t.e, e);
        this.unpipe();
        this.resume();
    }).
    on('end', function() {
        if (t.w) {
            this.unpipe();
            if (x === 'close') {
                t.push(null);
            } else if (t._readableState.pipes) {
                t._readableState.pipes.resume();
            }
        }
    }).
    on('readable', function() {
        if (!t.w) {
            this.unpipe();
            this.resume();
        }
    });
    if (!f && range) {
        if (chunked) {
            src.pipe(new bs(range)).pipe(new cs(chunked)).pipe(this._readableState.pipes, { end: false });
        } else {
            src.pipe(new bs(range)).pipe(this._readableState.pipes, { end: false });
        }
    } else {
        if (chunked) {
            src.pipe(new cs(chunked)).pipe(this._readableState.pipes, { end: false });
        } else {
            src.pipe(this._readableState.pipes, { end: false });
        }
    }
};

http.isSource = function(b) {
    let r = false;
    if (typeof b === 'object') {
        let t = typeof b.src;
        if (t === 'string') { // file
            r = true;
        } else if (t === 'object') { // readable stream
            if ('readable' in b.src && b.src.readable === true && typeof b.src.on === 'function' && typeof b.src.read === 'function' && typeof b.src.pipe === 'function' && typeof b.src._readableState === 'object') {
                r = true;
            }
        }
    }
    return r;
};
http.request = function(u) {
    let method = undefined,
        uri = undefined,
        protocol = u.slice(u.length - 9).toString().trim();
    if (protocol === 'HTTP/1.0' || protocol === 'HTTP/1.1') {
        let i = u.indexOf(http.S);
        if (i !== -1) {
            method = u.slice(0, i).toString();
            uri = u.slice(i + http.S.length, u.length - 9).toString().trim();
        }
    } else {
        protocol = undefined;
    }
    return {
        method: method,
        uri: uri,
        protocol: protocol
    };
};
http.header = function(h) {
    let i = 0,
        n = 0,
        a = [],
        l = http.N.length;
    while ((i = h.indexOf(http.N, i)) !== -1) {
        a.push(h.slice(n, i));
        i += l;
        n = i;
    }
    if (n > 0) {
        a.push(h.slice(n));
    }
    if (a.length === 0) {
        a = [h];
    }
    // for safety, set default values to undefined, if next node/js ver. will change it
    let hostname = undefined,
        port = undefined,
        length = undefined,
        connection = undefined,
        type = undefined,
        boundary = undefined,
        etag = undefined,
        modified = undefined,
        range = undefined;
    for (let k of a) {
        if (hostname === undefined && k.indexOf(http.CH) === 0) { // Host
            let v = k.slice(http.CH.length),
                j = v.indexOf(http.P);
            if (j === -1) {
                hostname = v.toString().trim().toLowerCase();
            } else { // port found in Host value
                hostname = v.slice(0, j).toString().trim().toLowerCase();
                port = parseInt(v.slice(j + http.P.length).toString().trim());
            }
        } else if (length === undefined && k.indexOf(http.CL) === 0) { // Content-Length
            length = parseInt(k.slice(http.CL.length).toString().trim());
        } else if (connection === undefined && k.indexOf(http.CN) === 0) { // Connection
            connection = k.slice(http.CN.length).toString().trim().toLowerCase();
        } else if (type === undefined && k.indexOf(http.CT) === 0) { // Content-Type
            if (k.indexOf(http.HU, http.CT.length) !== -1) {
                type = 'urlencoded';
            } else if (k.indexOf(http.HM, http.CT.length) !== -1) {
                type = 'multipart';
                let j = k.indexOf(http.HB, http.CT.length);
                if (j !== -1) { // boundary found
                    let b = k.indexOf(http.B, j + http.HB.length);
                    boundary = b === -1 ? k.slice(j + http.HB.length).toString().trim() : k.slice(j + http.HB.length, b).toString().trim();
                }
            }
        } else if (etag === undefined && k.indexOf(http.IN) === 0) { // If-None-Match
            etag = k.slice(http.IN.length).toString().trim();
        } else if (modified === undefined && k.indexOf(http.IM) === 0) { // If-Modified-Since
            modified = k.slice(http.IM.length).toString().trim();
        } else if (range === undefined && k.indexOf(http.CR) === 0) { // Range
            range = k.slice(http.CR.length).toString().trim();
        }
    }
    return {
        list: a,
        hostname: hostname,
        port: port,
        length: length,
        connection: connection,
        type: type,
        boundary: boundary,
        etag: etag,
        modified: modified,
        range: range
    };
};
http.parse = function(d, q) { // parse POST body data
    let b = {
            query: {},
            files: []
        },
        n = 0,
        x = [],
        y = Buffer.from('--' + q),
        i = y.length;
    while ((n = d.indexOf(y, n)) !== -1) {
        x.push(n);
        n += i;
    }
    n = x.length;
    if (n > 2) { // found parts
        for (let j = 0, z = 0, l = http.HF.length, r = http.HN.length; j < n - 1; j++) {
            let s = d.slice(x[j] + i + 2, x[j + 1]);
            if ((z = s.indexOf(http.L)) !== -1) {
                let h = s.slice(0, z),
                    c = s.slice(z + 4, -2);
                if ((z = h.indexOf(http.HF)) !== -1) { // is file, attachment
                    let m = h.slice(z + l);
                    if ((z = m.indexOf(http.Q)) !== -1) {
                        b.files.push({
                            name: m.slice(0, z).toString(),
                            data: c
                        });
                    }
                } else if ((z = h.indexOf(http.HN)) !== -1) { // is key, querystring
                    let m = h.slice(z + r);
                    if ((z = m.indexOf(http.Q)) !== -1) {
                        let k = m.slice(0, z).toString();
                        if (k in b.query) { // found the key
                            if (typeof b.query[k] === 'string') {
                                b.query[k] = [b.query[k]]; // create array for multiple key values, like querystring does
                            }
                            b.query[k].push(c.toString()); // push new key
                        } else { // add new key
                            b.query[k] = c.toString();
                        }
                    }
                }
            }
        }
    }
    return b;
};
http.range = function(d, l) { // verify Range bytes value
    let r = null,
        s = d.split('-');
    if (s.length === 2) {
        if (s[0] === '' && s[1] !== '') { // "-n" start l-n end l
            s[1] = parseInt(s[1]);
            if (s[1] > 0 && s[1] <= l) {
                r = [l - s[1], l];
            }
        } else if (s[0] !== '' && s[1] === '') { // "n-" start n end l
            s[0] = parseInt(s[0]);
            if (s[0] >= 0 && s[0] < l) {
                r = [s[0], l];
            }
        } else if (s[0] !== '' && s[1] !== '') { // "s-e" start s end e+1
            s[0] = parseInt(s[0]);
            s[1] = parseInt(s[1]);
            if (s[0] >= 0 && s[0] <= s[1] && s[1] < l) {
                r = [s[0], s[1] + 1];
            }
        }
    }
    return r;
};
http.etag = function(s) { // non-blocking (no I/O) safe sync call for md5 hex calculation
    return crypto.createHash('md5').update(s).digest('hex');
};

// store common values in memory for fast access and less I/O
http.n = '\r\n';
http.P = Buffer.from(':');
http.S = Buffer.from(' ');
http.B = Buffer.from(';');
http.Q = Buffer.from('"');
http.N = Buffer.from(http.n);
http.L = Buffer.concat([http.N, http.N]);
http.CH = Buffer.from('Host: ');
http.CL = Buffer.from('Content-Length: ');
http.CN = Buffer.from('Connection: ');
http.CT = Buffer.from('Content-Type: ');
http.CR = Buffer.from('Range: bytes=');
http.HU = Buffer.from('urlencoded');
http.HM = Buffer.from('multipart');
http.HB = Buffer.from('boundary=');
http.HF = Buffer.from('filename="');
http.HN = Buffer.from('name="');
http.IN = Buffer.from('If-None-Match: ');
http.IM = Buffer.from('If-Modified-Since: ');
http.EL = Buffer.from('0\r\n\r\n');

// status code RFC 7231
http.code = {
    100: '100 Continue',
    101: '101 Switching Protocols',
    200: '200 OK',
    201: '201 Created',
    202: '202 Accepted',
    203: '203 Non-Authoritative Information',
    204: '204 No Content',
    205: '205 Reset Content',
    206: '206 Partial Content',
    300: '300 Multiple Choices',
    301: '301 Moved Permanently',
    302: '302 Found',
    303: '303 See Other',
    304: '304 Not Modified',
    305: '305 Use Proxy',
    307: '307 Temporary Redirect',
    400: '400 Bad Request',
    401: '401 Unauthorized',
    402: '402 Payment Required',
    403: '403 Forbidden',
    404: '404 Not Found',
    405: '405 Method Not Allowed',
    406: '406 Not Acceptable',
    407: '407 Proxy Authentication Required',
    408: '408 Request Timeout',
    409: '409 Conflict',
    410: '410 Gone',
    411: '411 Length Required',
    412: '412 Precondition Failed',
    413: '413 Payload Too Large',
    414: '414 URI Too Long',
    415: '415 Unsupported Media Type',
    416: '416 Range Not Satisfiable',
    417: '417 Expectation Failed',
    426: '426 Upgrade Required',
    500: '500 Internal Server Error',
    501: '501 Not Implemented',
    502: '502 Bad Gateway',
    503: '503 Service Unavailable',
    504: '504 Gateway Timeout',
    505: '505 HTTP Version Not Supported'
};

// common MIME Types
http.type = {
    'unknown': 'application/octet-stream',
    // text, UTF-8 is added for safety
    'txt': 'text/plain; charset=UTF-8',
    'html': 'text/html; charset=UTF-8',
    'css': 'text/css; charset=UTF-8',
    'js': 'text/javascript; charset=UTF-8',
    'csv': 'text/csv; charset=UTF-8',
    'rtx': 'text/richtext; charset=UTF-8',
    // application
    'xml': 'application/xml',
    'xhtml': 'application/xhtml+xml',
    'rtf': 'application/rtf',
    'json': 'application/json',
    'jsonp': 'application/json-p',
    'ttf': 'application/x-font-ttf',
    'otf': 'application/x-font-opentype',
    'woff': 'application/font-woff',
    'doc': 'application/msword',
    'm3u8': 'application/vnd.apple.mpegurl',
    '7z': 'application/x-7z-compressed',
    'air': 'application/vnd.adobe.air-application-installer-package+zip',
    'swf': 'application/x-shockwave-flash',
    'pdf': 'application/pdf',
    'dir': 'application/x-director',
    'apk': 'application/vnd.android.package-archive',
    'mpkg': 'application/vnd.apple.installer+xml',
    'atom': 'application/atom+xml',
    'torrent': 'application/x-bittorrent',
    'sh': 'application/x-sh',
    'bz': 'application/x-bzip',
    'bz2': 'application/x-bzip2',
    'deb': 'application/x-debian-package',
    'exe': 'application/x-msdownload',
    'xls': 'application/vnd.ms-excel',
    'mxml': 'application/xv+xml',
    'ogx': 'application/ogg',
    'rar': 'application/x-rar-compressed',
    'rss': 'application/rss+xml',
    'tar': 'application/x-tar',
    'tcl': 'application/x-tcl',
    'xslt': 'application/xslt+xml',
    'zip': 'application/zip',
    // image
    'ico': 'image/x-icon',
    'gif': 'image/gif',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'bmp': 'image/bmp',
    'png': 'image/png',
    'svg': 'image/svg+xml',
    'tiff': 'image/tiff',
    'webp': 'image/webp',
    'xif': 'image/vnd.xiff',
    // audio
    'aac': 'audio/x-aac',
    'dts': 'audio/vnd.dts',
    'dtshd': 'audio/vnd.dts.hd',
    'm3u': 'audio/x-mpegurl',
    'wma': 'audio/x-ms-wma',
    'mid': 'audio/midi',
    'mpga': 'audio/mpeg',
    'mp4a': 'audio/mp4',
    'oga': 'audio/ogg',
    'weba': 'audio/webm',
    'ram': 'audio/x-pn-realaudio',
    'wav': 'audio/x-wav',
    // video
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mpeg': 'video/mpeg',
    'avi': 'video/x-msvideo',
    '3gp': 'video/3gpp',
    '3g2': 'video/3gpp2',
    'f4v': 'video/x-f4v',
    'flv': 'video/x-flv',
    'm4v': 'video/x-m4v',
    'h263': 'video/h263',
    'h264': 'video/h264',
    'asf': 'video/x-ms-asf',
    'wm': 'video/x-ms-wm',
    'wmx': 'video/x-ms-wmx',
    'wmv': 'video/x-ms-wmv',
    'wvx': 'video/x-ms-wvx',
    'ogv': 'video/ogg',
    'qt': 'video/quicktime',
    'jpgv': 'video/jpeg'
};

module.exports = http;
