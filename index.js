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
            super();
        } /*highWaterMark - internal buffer size, default: 16384*/
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
        if (this.b) {
            this.g = Buffer.from(this.b.toString(16));
        } /*convert chunk size into hex number*/
        this.h = true; /*data is header?*/
        this.z = Buffer.allocUnsafeSlow(0); /*create an un-pooled empty buffer*/
        this.c = this.z; /*init empty cache buffer*/
        this.s = {}; /*data header request*/
        this.w = true; /*connection is open?*/
        this.q = 0; /*data client request unique number*/
    }
}
