/* TEST FILE - Copyright (c) 2017 fast-stream - Tanase Laurentiu Iulian - https://github.com/RealTimeCom/fast-stream */
'use strict';

const http = require('./index.js'),
    fs = require('fs');

const config = {
    '*': {
        404: cb => cb('<html><body><h3>404 Not Found</h3></body></html>', null, 404), //optional, default 404 page
        GET: {
            '/': function(cb, req) {
                cb('<html><body><code>' + JSON.stringify(req) + '</code><code>' + JSON.stringify({
                    client: this.remoteAddress,
                    server: this.server.address()
                }) + '</code></body></html>');
            },
            '/30-720.mp4': cb => cb({src: '/home/laur/30-720.mp4'}, {
                'Content-Type': http.type['mp4'],
                'Content-Disposition': 'inline',
                'Content-Duration': 171,
                'X-Content-Duration': 171
            })
        }
    }
};

require('net').createServer(c => {
    console.log('client connected');
    c.
    on('error', e => console.log('socket error', e.toString())).
    on('end', () => console.log('socket end')).
    on('close', () => console.log('socket close')).
    pipe(new http(config, {
        limit: 1e4,
        chunked: 1e5,
        highWaterMark: 1e6
    })).
    on('httpError', e => console.log('httpError', e.toString())).
    pipe(c);
}).
on('error', e => console.log('server error', e.toString())).
listen(80, function() {
    console.log('server start', this.address());
});
