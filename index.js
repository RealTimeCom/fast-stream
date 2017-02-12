/* SOURCE FILE - Copyright (c) 2017 fast-stream - Tanase Laurentiu Iulian - https://github.com/RealTimeCom/fast-stream */
'use strict';

const Transform = require('stream').Transform,
    parse = require('url').parse,
    qs = require('querystring').parse,
    path = require('path'),
    fs = require('fs'),
    crypto = require('crypto'),
    bs = require('bytes-stream'),
    cs = require('chunks-stream'),
    mime = require('mimehttp');

class http extends Transform {
    constructor(f, opt) {
        super();
        if (!('pipes' in this._readableState)) { throw new Error('no readable pipe found'); }
        if (typeof opt !== 'object') { opt = {}; }
        this._ = { // private Object
            f: f, // config functions
            l: 'limit' in opt ? parseInt(opt.limit) : 5e8, // limit bytes ~500MB , client requests maximum bytes, anti memory overhead ( Infinity - to unlimit )
            r: 'ranges' in opt ? Boolean(opt.ranges) : true, // accept ranges request, default true
            e: 'error' in opt ? opt.error + '' : 'httpError', // custom error name event | "error" name will throw the error and exit the process
            n: 'name' in opt ? opt.name === null ? undefined : opt.name + '' : 'fast-stream/2.2', // Server name/version
            t: 'cache' in opt ? Boolean(opt.cache) : true, // client cache, default enabled, send/verify "Last-Modified" and/or "ETag" header
            i: 'closeOnError' in opt ? Boolean(opt.closeOnError) : false, // close connection on error, when http status code >= 400, default false, don't close
            b: 'chunked' in opt ? parseInt(opt.chunked) : 2e7, // chunk bytes ~20MB, 0 - disable
            z: Buffer.allocUnsafeSlow(0), // create an un-pooled empty buffer
            s: null, // next request is header
            w: true, // connection is open
            y: true // suppress errors
        };
        this._.c = this._.z; // init empty cache buffer
        if (this._.b) { // convert chunk size into hex number
            this._.g = Buffer.from(this._.b.toString(16)); // cache the value
        }
    }
}

http.prototype._transform = function(chunk, enc, cb) {
    if (this._.y) {
        this._.y = false;
        this._readableState.pipes.on('error', e => this.emit(this._.e, e)); // suppress errors
    }
    if (this._.w && this._readableState.pipes) { // connection is open?
        if (this._.c.length + chunk.length > this._.l) { // anti memory overhead
            this._error({ cb: cb }, 413, true); // true - close connection
        } else {
            this._.c = Buffer.concat([this._.c, chunk]); // append chunk to the cache buffer
            if (this._.s === null) { // request is header
                const l = this._.c.length,
                    i = this._.c.indexOf(http.L); // search for header/body separator
                if (i !== -1) { // separator found
                    const h = this._.c.slice(0, i), // header
                        j = h.indexOf(http.N); // request URI
                    let s = { cb: cb }; // cache header values & _transform callback function
                    if (j === -1) { // only request URI, HTTP/1.0
                        s.request = request(h);
                        s.header = headval(this._.z);
                    } else { // multiple header lines
                        s.request = request(h.slice(0, j));
                        s.header = headval(h.slice(j + http.N.length));
                    }
                    if (s.request.method === undefined || s.request.uri === undefined || s.request.protocol === undefined) {
                        this._error(s, 400, true); // true - close connection
                    } else if (!s.header.hostname && s.request.protocol === 'HTTP/1.1') { // "Host" header required for HTTP/1.1
                        this._error(s, 400, true); // true - close connection
                    } else {
                        if (!s.header.hostname) { s.header.hostname = '*'; }
                        let p = parse(s.request.uri, true);
                        if (!p.hostname) { p.hostname = '*'; }
                        s.path = p.pathname;
                        s.query = p.query;
                        // resolve port
                        if (s.header.port) {
                            s.port = s.header.port;
                        } else if (p.port) {
                            s.port = p.port;
                        } else if ('pipes' in this._readableState && 'remotePort' in this._readableState.pipes) {
                            s.port = this._readableState.pipes.remotePort;
                        } else { // set default port 80
                            s.port = 80;
                        }
                        s.hostname = s.header.hostname === '*' ? p.hostname : s.header.hostname;
                        s.host = s.hostname + ':' + s.port;
                        if (!(s.host in this._.f)) {
                            s.host = s.hostname;
                            if (!(s.host in this._.f)) {
                                s.host = '*:' + s.port;
                                if (!(s.host in this._.f)) { s.host = '*'; }
                            }
                        }
                        if (s.host in this._.f) { // found the host config function
                            const k = i + http.L.length; // header+separator length
                            if (s.request.method === 'HEAD' || s.request.method === 'GET') { // HEAD is same as GET, but only header data is sent
                                this._.c = this._.c.slice(k); // delete current request bytes from cache
                                this._fc(s, 'GET');
                            } else if (s.request.method === 'OPTIONS') {
                                this._.c = this._.c.slice(k); // delete current request bytes from cache
                                if (s.path === '*') { // request methods supported by server
                                    this._send(s, 'GET, HEAD, POST', { 'Content-Type': mime.type.txt, 'Allow': 'GET, HEAD, POST' });
                                } else { // request methods supported by pathname
                                    let c = [];
                                    if (typeof this._.f[s.host][404] === 'function') {
                                        c.push('GET', 'HEAD', 'POST');
                                    } else {
                                        if ('GET' in this._.f[s.host] && typeof this._.f[s.host]['GET'][s.path] === 'function') {
                                            c.push('GET', 'HEAD'); // HEAD is same as GET
                                        }
                                        if ('POST' in this._.f[s.host] && typeof this._.f[s.host]['POST'][s.path] === 'function') {
                                            c.push('POST');
                                        }
                                    }
                                    if (c.length === 0) {
                                        this._error(s, 405);
                                    } else {
                                        this._send(s, c.join(', '), { 'Content-Type': mime.type.txt, 'Allow': c.join(', ') });
                                    }
                                }
                            } else if (s.request.method === 'POST') {
                                if ('length' in s.header && s.header.length) { // "Content-Length" header required for POST
                                    if (s.header.length > this._.l) {
                                        this._error(s, 413, true); // "Content-Length" exceed the limit
                                    } else if (s.header.type === undefined) {
                                        this._error(s, 400, true); // "Content-Type" header required for POST
                                    } else if (s.header.type === 'multipart' && s.header.boundary === undefined) {
                                        this._error(s, 400, true); // no "boundary" found in multipart
                                    } else {
                                        const body = this._.c.slice(k, k + s.header.length);
                                        if (body.length === s.header.length) { // body complete
                                            this._.c = this._.c.slice(k + s.header.length); // delete current request header+body bytes from cache
                                            s.attach = s.header.type === 'multipart' ? bparse(body, s.header.boundary) : qs(body.toString());
                                            this._fc(s, 'POST');
                                        } else {
                                            this._.s = s; // next request is body
                                            this._.c = this._.c.slice(k); // delete current request header bytes from cache
                                            cb(); // need more data for body
                                        }
                                    }
                                } else {
                                    this._error(s, 411, true);
                                }
                            } else if (s.request.method === 'PUT' || s.request.method === 'DELETE' || s.request.method === 'TRACE' || s.request.method === 'CONNECT') {
                                //  TODO
                                this._error(s, 501, true); // true - close connection
                            } else {
                                this._error(s, 405, true);
                            }
                        } else {
                            this._error(s, 404, true);
                        }
                    }
                } else {
                    cb(); // need more data for header
                }
            } else { // request is body
                const s = this._.s,
                    body = this._.c.slice(0, s.header.length);
                if (body.length === s.header.length) { // body complete
                    this._.s = null; // next request is header
                    this._.c = this._.c.slice(s.header.length); // delete current request body bytes from cache
                    s.attach = s.header.type === 'multipart' ? bparse(body, s.header.boundary) : qs(body.toString());
                    this._fc(s, 'POST');
                } else {
                    cb(); // need more data for body
                }
            }
        }
    } else {
        cb(); // consume internal buffer
    }
};

http.prototype._flush = function(cb) {
    this._.w = false;
    cb();
};

http.prototype._error = function(s, code, x) {
    let h = { 'Content-Type': mime.type.txt };
    if (x) { h['Connection'] = 'close'; }
    this._send(s, http.code[code], h, code);
};

http.prototype._fc = function(s, method) {
    let f; // local function call
    if (method in this._.f[s.host] && typeof this._.f[s.host][method][s.path] === 'function') {
        f = this._.f[s.host][method][s.path];
    } else if (typeof this._.f[s.host][404] === 'function') {
        f = this._.f[s.host][404];
    }
    if (f === undefined) { // found the host config function
        this._error(s, 404);
    } else {
        f.bind(this)(this._send.bind(this, s), s);
    }
};

http.prototype._flen = function(s, body, header, code) {
    body.src = path.normalize(body.src.trim());
    if (!(body.src === '.' || body.src === '..')) {
        let t = this;
        fs.lstat(body.src, function(e, d) {
            if (e) {
                t.emit(t.e, e);
                t._error(s, 404);
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
                t._send(s, body, header, code);
            }
        });
    } else {
        this._error(s, 404);
    }
};

http.prototype._send = function(s, body, header, code) {
    if (this._.w && this._readableState.pipes) { // connection is open?
        if (typeof body === 'object' && typeof body.src === 'string' && typeof body.length !== 'number') { // file without length
            this._flen(s, body, header, code); // verify file and get the length
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
        if (!s.request) { s.request = {}; }
        if (!s.header) { s.header = {}; }
        if (!s.request.protocol) { s.request.protocol = 'HTTP/1.1'; }
        let src = false,
            m = s.host + ' ' + s.request.protocol + ' ' + s.request.method + ' ' + s.path;
        if (code >= 400) {
            if (this._.i) { // close connection
                header['Connection'] = 'close';
            } else if (code === 413) { // force close connection
                header['Connection'] = 'close';
            }
            this.emit(this._.e, new Error(code + ' ' + m)); // emit custom error event
        }
        // verify body value
        if (!Buffer.isBuffer(body)) {
            if (typeof body === 'string') {
                body = Buffer.from(body);
            } else if (readable(body)) {
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

        if (this._.t) { // cache enabled, compare ETag and Last-Modified values
            if (!src && !('ETag' in header)) { // ETag not found, create
                header['ETag'] = hetag(body);
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
            x = s.request.protocol === 'HTTP/1.1' && s.header.connection && s.header.connection === 'keep-alive' ? 'keep-alive' : 'close'; // can not use "keep-alive" on HTTP/1.0
        if ('Connection' in header && header['Connection'] !== 'keep-alive') { x = 'close'; }

        if (this._.r && code === 200 && l > 0 && s.request.protocol === 'HTTP/1.1' && s.header.range) { // range request
            range = hrange(s.header.range, l);
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
                this.emit(this._.e, new Error('416 ' + m)); // emit custom error event
                a.push(s.request.protocol + ' ' + http.code[416]);
                header['Content-Range'] = 'bytes */' + l;
                header['Accept-Ranges'] = 'bytes';
                l = 0; // send headers only
                if (this._.i) {
                    x = 'close';
                }
            }
        } else if (cached) { // the request is cached in browser
            a.push(s.request.protocol + ' ' + http.code[304]);
        } else {
            a.push(s.request.protocol + ' ' + http.code[code]);
        }
        if (!('Content-Type' in header)) {
            header['Content-Type'] = mime.type.html; // default "Content-Type"
        }
        if (!('Date' in header)) {
            header['Date'] = new Date().toUTCString();
        }
        if (!('Server' in header) && this._.n) {
            header['Server'] = this._.n;
        }
        if (!('Content-Length' in header) && l >= 0) {
            header['Content-Length'] = l;
        }
        if (!('Accept-Ranges' in header) && this._.r && l > 0 && s.request.protocol === 'HTTP/1.1') {
            header['Accept-Ranges'] = 'bytes'; // Accept-Ranges if body length>0
        }
        header['Connection'] = x; // for safety, overwrite header Connection value

        if ((s.request.method && s.request.method === 'HEAD') || cached || l === 0) { // send only headers
            for (let k in header) {
                a.push(k + ': ' + header[k]);
            }
            if (this._.w && this._readableState.pipes) {
                this.push(Buffer.concat([Buffer.from(a.join(http.n)), http.L]));
                if (x === 'close') { this.push(null); }
                s.cb(); // next chunk
            }
        } else {
            if (this._.b && s.request.protocol === 'HTTP/1.1' && (l === -1 || l > this._.b)) { // chunked
                if ('Content-Length' in header) {
                    delete header['Content-Length']; // delete "Content-Length" header when chunked enabled
                }
                header['Transfer-Encoding'] = 'chunked'; // set "Transfer-Encoding" header
                if (src) {
                    this._stream(s.cb, body.src, x, a, l, header, range, this._.b);
                } else {
                    //console.log('chunked', this._.b, range);
                    for (let k in header) {
                        a.push(k + ': ' + header[k]);
                    }
                    this.push(Buffer.concat([Buffer.from(a.join(http.n)), http.L])); // send headers

                    for (let y, i = 0; i < l; i += this._.b) { // for each chunk
                        y = (l < i + this._.b) ? l - i : this._.b;
                        if (this._.w && this._readableState.pipes) {
                            this.push(Buffer.concat([y === this._.b ? this._.g : Buffer.from(y.toString(16)), http.N, body.slice(i, i + y), http.N]));
                        } else {
                            break;
                        }
                    }
                    if (this._.w && this._readableState.pipes) { this.push(http.EL); } // push end bytes
                }
            } else { // not-chunked
                if (src) {
                    this._stream(s.cb, body.src, x, a, l, header, range, 0);
                } else {
                    //console.log('default', range);
                    for (let k in header) {
                        a.push(k + ': ' + header[k]);
                    }
                    this.push(Buffer.concat([Buffer.from(a.join(http.n)), http.L, body]));
                }
            }
            if (!src && this._.w && this._readableState.pipes) {
                if (x === 'close') { this.push(null); }
                s.cb(); // next request
            }
        }
    }
};

http.prototype._stream = function(cb, src, x, a, l, header, range, chunked) {
    if (this._readableState.pipes) {
        let t = this,
            f = (typeof src === 'string');
        //console.log(f ? 'file' : 'stream', x, chunked, range);
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
            this.unpipe();
            t.emit(t._.e, e);
            if (t._.w && t._readableState.pipes) {
                t.push(null); // close connection
                cb(); // consume internal buffer
            }
        }).
        on('end', function() {
            this.unpipe();
            if (t._.w && t._readableState.pipes) {
                if (x === 'close') { t.push(null); }
                cb(); // next request
            }
        }).
        on('readable', function() {
            if (!t._readableState.pipes) { // verify the readable stream
                this.unpipe();
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
    } else {
        this._error({ cb: cb }, 500);
    }
};

function readable(b) {
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
}

function request(u) {
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
}

function headval(h) {
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
}

function bparse(d, q) { // parse POST body data
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
}

function hrange(d, l) { // verify Range bytes value
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
}

function hetag(s) { // non-blocking (no I/O) safe sync call for md5 hex calculation
    return crypto.createHash('md5').update(s).digest('hex');
}

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

module.exports = http;
