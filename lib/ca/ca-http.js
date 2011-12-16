/*
 * ca-http.js: HTTP server abstraction for Cloud Analytics
 */

var mod_fs = require('fs');
var mod_http = require('http');
var mod_url = require('url');
var mod_querystring = require('querystring');
var mod_sys = require('sys');

var mod_connect = require('connect');
var mod_ca = require('./ca-common');
var ASSERT = require('assert');
var HTTP = require('./http-constants');

var ca_http_log_requests = true;
var ca_http_maxentity = 4096;		/* maximum request size (bytes) */
var ca_http_allowed_methods = [ 'POST', 'GET', 'DELETE', 'PUT' ].join(', ');

/*
 * Tell "connect" not to vomit exception stacktraces at the browser.
 */
if (process.connectEnv && process.connectEnv['name'])
	process.connectEnv['name'] = 'production';

function caHttpContentType(request)
{
	var content_type = request.headers['content-type'];
	var semi;

	/*
	 * See RFC2616 section 7.2.1.
	 */
	if (!content_type)
		return ('application/octet-stream');

	semi = content_type.indexOf(';');
	if (semi == -1)
		return (content_type);

	return (content_type.substring(0, semi));
}

function caHttpRouter(router)
{
	return (function (server) {
		/*
		 * We have to process OPTIONS because our response will have the
		 * appropriate Access-Control headers that will enable the
		 * browser to make a subsequent request (e.g., DELETE).  We add
		 * our handler after our caller's handlers to make sure we don't
		 * stomp on them.  With Chrome and Safari we can actually return
		 * "Bad method" and they'll still work as long as we supply the
		 * appropriate headers, but Firefox requires a successful
		 * return.  So we always return OK for OPTIONS even if the path
		 * is invalid.
		 */
		router(server);

		/* JSSTYLED */
		server.options(/.*/, function (request, response) {
			response.send(HTTP.OK);
		});
	});
}

function caHttpCatchall(request, response)
{
	response.send(HTTP.ENOTFOUND);
}

/*
 * Construct a basic server.  The 'conf' argument must specify the following
 * members:
 *
 *	log	logger for recording debug data
 *
 *	router	Connect-style router function describing how to handle URIs
 *
 * and one of the following members:
 *
 *	port		port number for incoming connections
 *
 *	port_base	same as port, but implies that the implementation should
 *			attempt to use consecutively numbered ports starting
 *			from this value until a free port is found
 *
 * and may specify any of the following members:
 *
 *	log_requests	logger for all requests
 *
 */
function caHttpServer(conf)
{
	ASSERT.ok(conf.log !== undefined);
	ASSERT.ok(conf.router !== undefined);
	ASSERT.ok(conf.port !== undefined || conf.port_base !== undefined);

	this.chs_log = conf.log;
	this.chs_port = conf.port || conf.port_base;
	this.chs_retry = conf.port_base !== undefined;
	this.chs_router = conf.router;
	this.chs_reqlog = conf.log_requests;
	this.chs_nrequests = 0;
	this.chs_nrequests_bycode = {};
	this.chs_pending = {};
	this.chs_npending = 0;
}

exports.caHttpServer = caHttpServer;

caHttpServer.prototype.port = function ()
{
	return (this.chs_port);
};

caHttpServer.prototype.start = function (callback)
{
	var srv = this;
	var init = function () { srv.initRequest.apply(srv, arguments); };
	var decode = function () { srv.decodeRequest.apply(srv, arguments); };
	var dotry;

	ASSERT.ok(this.chs_server === undefined,
	    'server object cannot be reused');

	dotry = function () {
		srv.chs_server = mod_connect.createServer(init, decode,
		    mod_connect.router(caHttpRouter(srv.chs_router)),
		    caHttpCatchall);
		srv.chs_server.listen(srv.chs_port, callback);
		srv.chs_server.showVersion = false;
		srv.chs_server.on('error', function (err) {
			srv.chs_server.removeListener('error',
			    arguments.callee);

			if (!srv.chs_retry || !err.errno ||
			    err.errno != 'EADDRINUSE')
				throw (err);

			srv.chs_port++;
			dotry();
		});
	};

	dotry();
};

/*
 * Although the server can be closed, it's not supported to start it back up.
 */
caHttpServer.prototype.stop = function (callback)
{
	this.chs_server.on('close', callback);
	this.chs_server.close();
};

/*
 * This first stage of request processing sets up the 'send' method of the
 * response for use by subsequent stages, then reads in the request and triggers
 * the next stage.
 */
caHttpServer.prototype.initRequest = function (request, response, next)
{
	var server = this;
	var orig_end, orig_write, orig_head;

	/*
	 * We add a 'send' method to the response object which provides a simple
	 * interface for consumers to send most types of responses.  Consumers
	 * need only specify a response code, but can also specify a string
	 * (e.g. an error message) or an object to be JSON-encoded.  We assert
	 * that the method doesn't exist to future-proof ourselves against
	 * future versions of node using this method name in the future.
	 */
	ASSERT.ok(!response.send);
	response.send = function (code, body, headers) {
		var response_data, logtext;

		if (!headers)
			headers = {};

		/*
		 * The Access-Control-Allow-* headers allow strict clients (like
		 * Google Chrome) to know that this server really does allow
		 * itself to be invoked from web pages it didn't serve.
		 */
		headers['Access-Control-Allow-Origin'] = '*';
		headers['Access-Control-Allow-Methods'] =
		    ca_http_allowed_methods;

		if (!body) {
			response_data = '';
			logtext = '';
		} else if (typeof (body) == typeof ('')) {
			response_data = body;
			logtext = body;
		} else {
			headers['Content-Type'] = 'application/json';
			logtext = JSON.stringify(body);
			response_data = logtext + '\n';
		}

		if (code >= HTTP.EBADREQUEST && request.method != 'OPTIONS') {
			server.chs_log.warn('HTTP request failed with %d: ' +
			    '%s %s: %s', code, request.method, request.url,
			    logtext);
		}

		response.writeHead(code, headers);
		response.end(response_data);
	};

	response.sendError = function (exn, code) {
		var status, errcode;

		if (arguments.length > 1)
			status = code;
		else if (!(exn instanceof caError))
			status = HTTP.ESERVER;
		else if (exn.code() == ECA_INVAL)
			status = HTTP.ECONFLICT;
		else if (exn.code() == ECA_NORESOURCE ||
		    exn.code() == ECA_TIMEDOUT)
			status = HTTP.ESRVUNAVAIL;
		else
			status = HTTP.ESERVER;

		if (status == HTTP.ESERVER)
			server.chs_log.error('sending error for exn: %r', exn);

		errcode = exn instanceof caError ? exn.code() : ECA_UNKNOWN;

		response.send(status, {
		    error: { code: errcode, message: exn.message }
		});
	};

	/*
	 * We also override 'end', writeHead, and "write" to manipulate our own
	 * counters for requests that don't use the "send" entry point directly.
	 */
	orig_end = response.end;
	orig_write = response.write;
	orig_head = response.writeHead;
	request.ca_start = new Date().getTime();
	request.ca_response_length = 0;
	request.ca_requestid = this.chs_nrequests++;
	this.chs_pending[request.ca_requestid] = request;
	this.chs_npending++;

	response.writeHead = function (response_code) {
		request.ca_code = response_code;
		return (orig_head.apply(response, arguments));
	};

	response.write = function (chunk) {
		request.ca_response_length += chunk.length;
		return (orig_write.apply(response, arguments));
	};

	response.end = function () {
		request.ca_latency = new Date().getTime() - request.ca_start;
		server.logRequest(request);
		server.chs_npending--;

		if (!server.chs_nrequests_bycode[request.ca_code])
			server.chs_nrequests_bycode[request.ca_code] = 0;

		server.chs_nrequests_bycode[request.ca_code]++;
		delete (server.chs_pending[request.ca_requestid]);
		return (orig_end.apply(response, arguments));
	};

	/*
	 * We shouldn't be getting large requests, so we slurp it all in at
	 * once.  If it's bigger than 4K, though, we bomb out to avoid someone
	 * shoving too much data at us.
	 */
	request.ca_body = '';
	request.on('data', function (chunk) {
		if (request.ca_body.length + chunk.length > ca_http_maxentity) {
			response.send(HTTP.ETOOLARGE);
			request.destroy(); /* XXX */
			return;
		}

		request.ca_body += chunk;
	});

	request.on('end', function () { next(); });
};

/*
 * This second stage of request processing parses the form fields specified in
 * the query string and the form fields or JSON object encoded in the
 * entity-body, then triggers the next stage.
 */
caHttpServer.prototype.decodeRequest = function (request, response, next)
{
	var url, params, bodyparams, content_type, key, apivers, parts;

	/*
	 * Recall that form fields can be specified either in the URL's query
	 * string or encoded in the request body.  While these two approaches
	 * are typically used with GET and POST respectively, the standards do
	 * not require that so we always ignore the HTTP method in processing
	 * the form fields.
	 */
	url = mod_url.parse(request.url);
	params = 'query' in url ? mod_querystring.parse(url.query) : {};

	/*
	 * For form fields encoded in the request body, we only support the more
	 * common url-encoding, not multipart/form-data.  See HTML4 section
	 * 17.13.4 for details.
	 */
	content_type = caHttpContentType(request);
	if (content_type == 'multipart/form-data')
		return (response.sendError(new caError(ECA_INVAL, null,
		    'multipart form data is not supported'),
		    HTTP.EUNSUPMEDIATYPE));

	/*
	 * Neither the HTML nor HTTP (via RFC2616) specifications say how the
	 * server should interpret form fields that are specified in both the
	 * URL's query string and the request body.  CGI (RFC 3875), which we're
	 * not implementing but is at least related, suggests that both should
	 * be used but doesn't specify whether the two sets of fields should be
	 * kept separate or merged or if merged then how.  We take the easiest
	 * way out: if a form field is specified both in the URL and the body,
	 * we ignore the values in the URL.  This isn't even a proper merge,
	 * since we could actually combine the values (as would happen if the
	 * same values had been specified multiple times in either the URL or
	 * body), but it's unreasonable for the client to expect any particular
	 * behavior here.  This behavior should be made explicitly unspecified
	 * in the API.
	 */
	if (content_type == 'application/x-www-form-urlencoded') {
		bodyparams = mod_querystring.parse(request.ca_body) || {};

		for (key in bodyparams)
			params[key] = bodyparams[key];
	}

	request.ca_params = params;

	if (content_type == 'application/json') {
		try {
			request.ca_json = JSON.parse(request.ca_body);
		} catch (ex) {
			return (response.sendError(new caError(ECA_INVAL, null,
			    'failed to parse JSON: ' + ex.message)));
		}
	}

	/*
	 * Check the API version and store it in the request object.
	 */
	if ('x-api-version' in request.headers)
		apivers = request.headers['x-api-version'];
	else
		apivers = 'ca/0.1.0';

	if (apivers.substring(0, 3) !== 'ca/')
		return (response.sendError(new caError(ECA_INVAL, null,
		    'invalid API version string: %s', apivers)));

	parts = apivers.substring(3).split('.');
	if (parts.length != 3)
		return (response.sendError(new caError(ECA_INVAL, null,
		    'invalid API version string: %s', apivers)));

	request.ca_api_vers = apivers;
	request.ca_api_major = parts[0];
	request.ca_api_minor = parts[1];
	request.ca_api_micro = parts[2];

	return (next());
};

/*
 * Returns an object with debug information about the current server.
 */
caHttpServer.prototype.info = function ()
{
	var ret = {};
	ret['ca_http_maxentity'] = ca_http_maxentity;
	ret['ca_http_ca_allowed_methods'] = ca_http_allowed_methods;
	ret['npending'] = this.chs_npending;
	ret['nrequests'] = this.chs_nrequests;
	ret['nrequests_bycode'] = this.chs_nrequests_bycode;
	return (ret);
};

caHttpServer.prototype.logRequest = function (request)
{
	if (!this.chs_reqlog || !ca_http_log_requests)
		return;

	this.chs_reqlog.info('%3d %5d %5dms %-4s %s', request.ca_code,
	    request.ca_response_length, request.ca_latency, request.method,
	    request.url);
};

/*
 * Given an HTTP request and response, forward the request to the specified host
 * and port and forward the response for that request to the original response.
 * This essentially proxies the given request/response to the specified
 * host/port, but ignores everything in the HTTP RFC around proxies.
 *
 * When this function is invoked, it takes ownership of the given request and
 * response.  The consumer need not (and should not) use them again.  If this
 * function fails, an appropriate response will be returned.
 *
 * This implementation partially supports requests from HTTP/1.0 clients.  This
 * behavior has not been extensively tested, but we at least take care to avoid
 * using transfer-encoding when talking to such clients.  This is important
 * because in practice this client will be an nginx proxy, which only speaks
 * HTTP/1.0.  We assume that the server we're forwarding to supports HTTP/1.1.
 */
function caHttpForward(request, response, host, port, extraheaders, log)
{
	var subrequest, subheaders, hdr, nostream;

	subheaders = mod_ca.caDeepCopy(request.headers);
	subheaders['transfer-encoding'] = 'chunked';

	for (hdr in extraheaders)
		subheaders[hdr] = extraheaders[hdr];

	nostream = (request.httpVersion == '1.0');

	subrequest = mod_http.request({
	    host: host,
	    port: port,
	    method: request.method,
	    path: request.url,
	    headers: subheaders
	});

	subrequest.on('error', function (error) {
		log.error('error forwarding HTTP request to %s:%s: %r',
		    host, port, error);
		response.send(HTTP.ESRVUNAVAIL);
	});

	if ('ca_body' in request) {
		/*
		 * This request was preprocessed by caHttp above.
		 */
		subrequest.end(request.ca_body);
	} else {
		request.on('data', function (chunk) {
			subrequest.write(chunk);
		});

		request.on('end', function () { subrequest.end(); });
	}

	subrequest.on('response', function (subresponse) {
		var body = '', code = subresponse.statusCode;

		subheaders = subresponse.headers;

		if (nostream) {
			if ('transfer-encoding' in subheaders)
				delete (subheaders['transfer-encoding']);
			response.writeHead(code, subheaders);
			subresponse.on('data',
			    function (chunk) { body += chunk; });
			subresponse.on('end',
			    function () { response.end(body); });
			return;
		}

		subheaders = mod_ca.caDeepCopy(subheaders);
		subheaders['transfer-encoding'] = 'chunked';

		response.writeHead(subresponse.statusCode, subheaders);
		subresponse.on('data',
		    function (chunk) { response.write(chunk); });
		subresponse.on('end', function () { response.end(); });
	});
}

exports.caHttpForward = caHttpForward;

function caHttpFileServe(request, response, filename)
{
	var stream, started;

	stream = mod_fs.createReadStream(filename);

	stream.on('error', function (err) {
		response.sendError(new caSystemError(err));
	});

	stream.on('data', function () {
		if (started)
			return;

		started = true;
		response.writeHead(HTTP.OK);
	});

	mod_sys.pump(stream, response);
}

exports.caHttpFileServe = caHttpFileServe;
