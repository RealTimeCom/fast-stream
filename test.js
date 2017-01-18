/* TEST FILE - Copyright (c) 2017 fast-stream - Tanase Laurentiu Iulian - https://github.com/RealTimeCom/fast-stream */
'use strict';

const http = require('./index.js'),
    fs = require('fs');

const config = {

    '192.168.56.101:80': { // hostname:port
        404: (cb, req) => cb('<html><body><h3>404 Not Found</h3><code>' + JSON.stringify(req) + '</code></body></html>', null, 404), //optional, default 404 page for this host
        GET: {
            '/': function(cb, req) {
                cb('<html><body><code>' + JSON.stringify(req) + '</code><code>' + JSON.stringify({
                    client: this.remoteAddress,
                    server: this.server.address()
                }) + '</code></body></html>');
            }
        }
    }

};

require('net').createServer(c => {
    console.log('client connected');
    c.
    on('error', e => console.log('socket error', e.toString())).
    on('end', () => console.log('socket end')).
    on('close', () => console.log('socket close')).
    pipe(new http(fc, {
        limit: 1e4,
        chunked: 1e5,
        highWaterMark: 1e6
    })).
    on('httpError', e => console.log('httpError', e.toString())).
    pipe(c);
}).
on('error', e => console.log('server error', e.toString())).
listen(80, '192.168.56.101', function() {
    console.log('server start', this.address());
});
