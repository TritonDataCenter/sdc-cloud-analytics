/*
 * ca-http.js: HTTP server abstraction for Cloud Analytics
 */

var mod_url = require('url');
var mod_querystring = require('querystring');
var mod_connect = require('connect');
var ASSERT = require('assert');
var HTTP = require('./http-constants');

var ca_http_maxentity = 4096;		/* maximum request size (bytes) */
var ca_http_allowed_methods = [ 'POST', 'GET', 'DELETE', 'PUT' ].join(', ');

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

/*
 * Construct a basic server.  The 'conf' argument must specify the following
 * methods:
 *
 *	log	logger for recording debug data
 *
 *	port	TCP port on which to listen for requests
 *
 *	router	Connect-style router function describing how to handle URIs
 */
function caHttpServer(conf)
{
	var server = this;

	ASSERT.ok(conf.log !== undefined);
	ASSERT.ok(conf.port !== undefined);
	ASSERT.ok(conf.router !== undefined);

	this.chs_log = conf.log;
	this.chs_port = conf.port;
	this.chs_server = mod_connect.createServer(
	    function (r, s, n) { server.initRequest(r, s, n); },
	    function (r, s, n) { server.decodeRequest(r, s, n); },
	    mod_connect.router(caHttpRouter(conf.router)));
	this.chs_server.showVersion = false;
}

exports.caHttpServer = caHttpServer;

caHttpServer.prototype.start = function (callback)
{
	this.chs_server.listen(this.chs_port, callback);
};

/*
 * This first stage of request processing sets up the 'send' method of the
 * response for use by subsequent stages, then reads in the request and triggers
 * the next stage.
 */
caHttpServer.prototype.initRequest = function (request, response, next)
{
	var server = this;

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
		var response_data;

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
		} else if (typeof (body) == typeof ('')) {
			response_data = body;
		} else {
			headers['Content-Type'] = 'application/json';
			response_data = JSON.stringify(body) + '\n';
		}

		if (code >= HTTP.EBADREQUEST && request.method != 'OPTIONS')
			server.chs_log.warn('HTTP request failed with %d : ' +
			    '%s %s: %s', code, request.method, request.url,
			    response_data);

		response.writeHead(code, headers);
		response.end(response_data);
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
	var url, params, bodyparams, content_type, key;

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
	if (content_type == 'multipart/form-data') {
		response.send(HTTP.EUNSUPMEDIATYPE,
		    { error: 'multipart form data is not supported.' });
		return;
	}

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
			response.send(HTTP.EBADREQUEST,
			    { error: 'failed to parse JSON: ' + ex.message });
			return;
		}
	}

	next();
};
