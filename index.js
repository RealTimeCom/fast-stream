/* SOURCE FILE - Copyright (c) 2017 fast-stream - Tanase Laurentiu Iulian - https://github.com/RealTimeCom/fast-stream */
'use strict';

const Transform = require('stream').Transform,
    parse = require('url').parse,
    qs = require('querystring').parse,
    path = require('path'),
    fs = require('fs'),
    crypto = require('crypto');

class http extends Transform {
    constructor(f, opt) {
        if ('highWaterMark' in opt && opt.highWaterMark) {
            super({
                highWaterMark: parseInt(opt.highWaterMark) /*high highWaterMark => less I/O, more memory consumption*/
            });
        } else {
            super(); /*highWaterMark - internal buffer size, default: 16384*/
        }
        if (typeof this._readableState.pipes !== 'object') {
            throw new Error('no readable pipe found');
        }
        this.f = f; /*config functions*/
        this.l = 'limit' in opt ? parseInt(opt.limit) : 1e8; /*limit bytes, client request header+body maximum bytes, anti memory overhead*/
        this.r = 'ranges' in opt ? Boolean(opt.ranges) : true; /*accept ranges request, default true*/
        this.e = 'error' in opt ? opt.error + '' : 'httpError'; /*custom error name event | "error" name will throw the error and exit the process*/
        this.n = 'name' in opt ? opt.name === null ? undefined : opt.name + '' : 'fast-stream/1.0'; /*Server name/version*/
        this.t = 'cache' in opt ? Boolean(opt.cache) : true; /*cache, default enabled, send/verify "Last-Modified" and/or "ETag" header*/
        this.i = 'closeOnError' in opt ? Boolean(opt.closeOnError) : true; /*close connection on error when code>=400, default true for safety, but less speed*/
        this.b = 'chunked' in opt ? parseInt(opt.chunked) : 1e6; /*chunk bytes, 0-disable*/
        if (this.b) { /*convert chunk size into hex number*/
            this.g = Buffer.from(this.b.toString(16));
        }
        this.h = true; /*data is header?*/
        this.z = Buffer.allocUnsafeSlow(0); /*create an un-pooled empty buffer*/
        this.c = this.z; /*init empty cache buffer*/
        this.s = {}; /*data header request*/
        this.w = true; /*connection is open?*/
        this.q = 0; /*data client request unique number*/
    }
}
http.prototype._transform = function(chunk, enc, cb) {
    if (this.q === Number.MAX_SAFE_INTEGER) {
        this.q = 0;
    }
    this.q++;
    if (this.c.length + chunk.length > this.l) {
        this.error(413);
    } else {
        this.c = Buffer.concat([this.c, chunk]); /*append chunk to cache*/
        if (this.h) { /*chunk is header*/
            this.s = {}; /*init/reset this.s*/
            let l = this.c.length,
                i = this.c.indexOf(http.L); /*search for separator*/
            if (i !== -1) { /*separator is found*/
                let request, header, h = this.c.slice(0, i),
                    j = h.indexOf(http.N);
                if (j === -1) { /*one header line, HTTP/1.0*/
                    this.s['request'] = http.request(h);
                    this.s['header'] = http.header(this.z);
                } else { /*multiple header lines*/
                    this.s['request'] = http.request(h.slice(0, j));
                    this.s['header'] = http.header(h.slice(j + http.N.length));
                }
                if (this.s.request.method === undefined || this.s.request.uri === undefined || this.s.request.protocol === undefined) {
                    this.error(400);
                } else if (!this.s.header.hostname && this.s.request.protocol === 'HTTP/1.1') { /*"Host" header required for HTTP/1.1*/
                    this.error(400);
                }
                else {
                    let p = parse(this.s.request.uri, true);
                    this.s['path'] = p.pathname;
                    this.s['query'] = p.query;
                    /*resolve port*/
                    if (this.s.header.port) {
                        this.s['port'] = this.s.header.port;
                    } else if (p.port) {
                        this.s['port'] = p.port;
                    } else if ('pipes' in this._readableState && 'localPort' in this._readableState.pipes) {
                        this.s['port'] = this._readableState.pipes.localPort;
                    } else {
                        this.s['port'] = 80; /*set default port 80*/
                    }
                    /*resolve hostname*/
                    if (this.s.header.hostname || p.hostname) {
                        this.s['hostname'] = this.s.header.hostname ? this.s.header.hostname : p.hostname;
                        this.s['host'] = this.s['hostname'] + ':' + this.s['port'];
                        if (this.s.host in this.f) {
                            if (this.s.request.method === 'HEAD' || this.s.request.method === 'GET') { /*HEAD is same as GET, but only header data is sent*/
                                this.c = this.c.slice(i + http.L.length); /*cache remaining bytes, for next request*/
                                this.fc('GET');
                            } else if (this.s.request.method === 'OPTIONS') {
                                this.c = this.c.slice(i + http.L.length); /*cache remaining bytes, for next request*/
                                if (this.s.path === '*') { /*request methods supported by server*/
                                    this.send(this.q, this.s, 'GET, HEAD, POST', {
                                        'Content-Type': http.type.txt,
                                        Allow: 'GET, HEAD, POST'
                                    });
                                } else { /*request methods supported by pathname*/
                                    let c = [];
                                    if ('GET' in this.f[this.s.host] && typeof this.f[this.s.host]['GET'][this.s.path] === 'function') {
                                        c.push('GET', 'HEAD');
                                    } /*HEAD is same as GET*/
                                    if ('POST' in this.f[this.s.host] && typeof this.f[this.s.host]['POST'][this.s.path] === 'function') {
                                        c.push('POST');
                                    }
                                    if (c.length === 0) {
                                        this.error(405);
                                    } else {
                                        this.send(this.q, this.s, c.join(', '), {
                                            'Content-Type': http.type.txt,
                                            Allow: c.join(', ')
                                        });
                                    }
                                }
                            } else if (this.s.request.method === 'POST') {
                                if ('length' in this.s.header && this.s.header.length) { /*"Content-Length" header required for POST*/
                                    if (this.s.header.length > this.l) {
                                        this.error(413);
                                    } /*"Content-Length" exceed the limit*/
                                    else if (this.s.header.type === undefined) {
                                        this.error(400);
                                    } /*"Content-Type" header required for POST*/
                                    else if (this.s.header.type === 'multipart' && this.s.header.boundary === undefined) {
                                        this.error(400);
                                    } /*no boundary found in multipart*/
                                    else {
                                        let body = this.c.slice(i + http.L.length);
                                        if (body.length >= this.s.header.length) { /*body complete*/
                                            if (body.length > this.s.header.length) {
                                                body = body.slice(0, this.s.header.length);
                                                this.c = body.slice(this.s.header.length); /*cache remaining bytes, for next request*/
                                            } else {
                                                this.c = this.z; /*empty cache*/
                                            }
                                            this.s['attach'] = this.s.header.type === 'multipart' ? http.parse(body, this.s.header.boundary) : qs(body.toString());
                                            this.fc('POST');
                                        } else { /*need more bytes for body*/
                                            this.h = false; /*next chunk is body*/
                                            this.c = body; /*save body part to cache*/
                                        }
                                    }
                                } else {
                                    this.error(411);
                                }
                            } else if (this.s.request.method === 'PUT' || this.s.request.method === 'DELETE' || this.s.request.method === 'TRACE' || this.s.request.method === 'CONNECT') {
                                /* TODO */
                                this.c = this.c.slice(i + http.L.length); /*cache remaining bytes, for next request*/
                                this.error(501);
                            } else {
                                this.c = this.c.slice(i + http.L.length); /*cache remaining bytes, for next request*/
                                this.error(405);
                            }
                        } else {
                            this.c = this.c.slice(i + http.L.length); /*cache remaining bytes, for next request*/
                            this.error(404);
                        }
                    } else { /*Host not found*/
                        this.c = this.c.slice(i + http.L.length); /*cache remaining bytes, for next request*/
                        this.error(400);
                    }
                }
            } /*need more bytes for header*/
        } else { /*chunk is body*/
            if (this.c.length >= this.s.header.length) { /*body complete*/
                let body;
                if (this.c.length > this.s.header.length) {
                    body = this.c.slice(0, this.s.header.length);
                    this.c = this.c.slice(this.s.header.length); /*cache remaining bytes, for next request*/
                } else {
                    body = this.c;
                    this.c = this.z; /*empty cache*/
                }
                this.s['attach'] = this.s.header.type === 'multipart' ? http.parse(body, this.s.header.boundary) : qs(body.toString());
                this.h = true; /*next chunk is header*/
                this.fc('POST');
            } /*need more bytes for body*/
        }
    }
    cb();
};
http.prototype._flush = function(cb) {
    this.w = false; /*connection end, prevent any data to be sent*/
    cb();
};

http.prototype.fc = function(method) {
    //this.c = this.z; /*empty cache*/
    let f = undefined; /*local function call*/
    /*this.send.bind(this,this.q) > bind "this" object to send() function and push first argument "this.q" for callback send()*/
    if (method in this.f[this.s.host] && typeof this.f[this.s.host][method][this.s.path] === 'function') {
        f = this.f[this.s.host][method][this.s.path];
    } else if (typeof this.f[this.s.host][404] === 'function') {
        f = this.f[this.s.host][404];
    }
    if (f === undefined) { /*function call not found*/
        this.error(404);
    } else {
        f.bind(this._readableState.pipes)(this.send.bind(this, this.q, this.s), this.s);
    }
};

http.prototype.error = function(code) {
    //this.c = this.z; /*empty cache*/
    this.send(this.q, this.s, http.code[code], {
        'Content-Type': http.type.txt
    }, code);
};

http.prototype.fileLength = function(q, s, body, header, code) {
    body.src = path.normalize(body.src.trim());
    //console.log('body.src', body.src);
    if (!(body.src === '.' || body.src === '..')) {
        let t = this;
        fs.lstat(body.src, function(e, d) {
            if (e) {
                t.emit(t.e, new Error(e));
                t.send(q, s, http.code[404], {
                    'Content-Type': http.type.txt
                }, 404);
            } else {
                //console.log(body.src,d.size);
                if (t.t) { /*cache enabled*/
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
                t.send(q, s, body, header, code);
            }
        });
    } else {
        this.send(q, s, http.code[404], {
            'Content-Type': http.type.txt
        }, 404);
    }
};
