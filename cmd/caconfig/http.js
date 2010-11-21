/*
 * caconfig/http: Config service HTTP server.
 *
 * This component runs the HTTP service, dispatching requests to the rest of
 * the server.
 */

var mod_sys = require('sys');
var mod_http = require('http');
var mod_events = require('events');
var mod_url = require('url');
var mod_querystring = require('querystring');

var HTTP = require('http-constants');

var cfg_http_maxentity	= 4 * 1024;		/* maximium request size: 4K */

/*
 * Convert an absolute URI into an array of non-empty strings representing the
 * URI's components.  For example, converts '/foo/bar//bug/' to [ 'foo', 'bar',
 * 'bug' ].  Returns undefined if the URI is malformed.
 */
function cfgHttpUriToComponents(uri)
{
	var parts = uri.split('/');
	var ii = 0;
	var ret = [];

	/* Check for non-absolute URIs. */
	if (parts[0] !== '')
		return (undefined);

	for (ii = 1; ii < parts.length; ii++) {
		if (parts[ii].length > 0)
			ret.push(parts[ii]);
	}

	return (ret);
}

/*
 * Manages the HTTP interaction for this service.  This doesn't do anything
 * until the 'start' method is invoked.  The 'conf' argument must contain the
 * following member:
 *
 *	port		Local TCP port on which to serve HTTP
 *
 *	log		Log handle (for recording debugging messages)
 *
 * This object emits an event for each received request.  Event listener
 * functions receive two arguments:
 *
 *	args		Object specifying additional named arguments.  The set
 *			of available named arguments is specific to each event.
 *
 *	callback	Function to be invoked when servicing this request is
 *			complete.  This function MUST be invoked within a
 *			reasonable time after the listener is invoked, since
 *			clients are waiting on the response.  The function is
 *			invoked as
 *
 *				callback(code, result[, headers])
 *
 *			'code' will be used as the HTTP response code.  'result'
 *			will be serialized and sent back to the client.
 *			'result' could reasonably be a Javascript object
 *			representing a resource or a simple string (as an error
 *			message, for example).  If specified, 'headers' will be
 *			sent as HTTP headers with the response.
 *
 * Events include:
 *
 *	inst-create	Request received to create a new instrumentation.
 *			Named arguments: username, inst spec
 *
 *	inst-value	Request received to retrieve instrumentation value.
 *			Named arguments: username, inst id
 *
 *	inst-delete	Request received to destroy an instrumentation.
 *			Named arguments: username, inst id
 *
 *	list-metrics	Request received to list all available metrics.
 *			Named arguments: username
 */
function caConfigHttp(conf)
{
	var cfghttp = this;

	mod_events.EventEmitter.call(this);

	this.cah_log = conf.log;
	this.cah_port = conf.port;
	this.cah_server = mod_http.createServer(
	    function (request, response) {
		cfghttp.gotRequest(request, response);
	    });
}

mod_sys.inherits(caConfigHttp, mod_events.EventEmitter);
exports.caConfigHttp = caConfigHttp;

caConfigHttp.prototype.start = function (callback)
{
	this.cah_server.listen(this.cah_port, callback);
};

/*
 * Invoked when we initially receive a request.  Slurps in the entity-body and
 * then invokes the next routine to actually process the request.
 */
caConfigHttp.prototype.gotRequest = function (request, response)
{
	var cfghttp = this;
	var reqdata = '';

	/*
	 * We shouldn't be getting large requests, so we slurp it all in at
	 * once.  If it's bigger than 4K, though, we bomb out to avoid someone
	 * shoving too much data at us.
	 */
	request.on('data', function (chunk) {
		if (reqdata.length + chunk.length > cfg_http_maxentity) {
			response.writeHead(HTTP.ETOOLARGE, HTTP.MSG_ETOOLARGE);
			response.end();
			request.destroy(); /* XXX */
			return;
		}

		reqdata += chunk;
	});

	request.on('end', function () {
		request.cfg_reqdata = reqdata;
		cfghttp.processRequest(request, response, reqdata);
	});
};

/*
 * Invoked after we've finished reading the request to actually process it.
 */
caConfigHttp.prototype.processRequest = function (request, response, reqdata)
{
	var cfghttp = this;
	var url, params, bodyparams, part, parts, content_type, key;

	var callback = function (code, data, headers) {
	    cfghttp.sendResponse(request, response, code, data, headers);
	};

	/*
	 * Recall that form fields can be specified either in the URL's query
	 * string or encoded in the request body.  While these two approaches
	 * are typically used with GET and POST respectively, the standards do
	 * not require that so we always ignore the HTTP method in processing
	 * the form fields.
	 */
	url = mod_url.parse(request.url);
	params = 'query' in url ? mod_querystring.parse(url.query) : {};
	parts = cfgHttpUriToComponents(url.pathname);

	if (!parts)
		return (callback(HTTP.EBADREQUEST,
		    'error: expected absolute URI'));

	part = parts.shift();

	if (part != 'metrics' && part != 'instrumentation')
		return (callback(HTTP.ENOTFOUND,
		    'error: requested resource was not found'));

	/*
	 * For form fields encoded in the request body, we only support the more
	 * common url-encoding, not multipart/form-data.  See HTML4 section
	 * 17.13.4 for details.
	 */
	content_type = request.headers['content-type'];
	if (content_type !== undefined &&
	    content_type.indexOf('multipart/form-data;') === 0)
		return (callback(HTTP.EUNSUPMEDIATYPE,
		    'error: multipart form data is not supported.'));

	/*
	 * Neither the HTML nor HTTP (via RFC2616) specifications say how the
	 * server should interpret form fields that are specified in both the
	 * URL's query string and the request body.  CGI (RFC 3875), which we're
	 * not implementing but is at least related, suggests that both should
	 * be used but doesn't specify whether the two sets of fields should be
	 * kept separately or merged or if merged then how.  We take the easiest
	 * way out: if a form field is specified both in the URL and the body,
	 * we ignore the values in the URL.  This isn't even a proper merge,
	 * since we could actually combine the values (as would happen if the
	 * same values had been specified multiple times in either the URL or
	 * body), but it's unreasonable for the client to expect any particular
	 * behavior here.  This behavior should be made explicitly unspecified
	 * in the API.
	 */
	if (content_type == 'application/x-www-form-urlencoded') {
		bodyparams = mod_querystring.parse(reqdata);

		for (key in bodyparams)
			params[key] = bodyparams[key];
	}

	if (part == 'metrics') {
		if (parts.length > 0)
			return (callback(HTTP.ENOTFOUND,
			    'error: requested resource was not found'));
		return (this.listMetrics(callback));
	}

	if (parts.length === 0)
		return (this.createInst(request, params, reqdata, callback));

	part = parts.shift();

	if (parts.length > 1)
		return (callback(HTTP.ENOTFOUND,
		    'error: the requested resource was not found'));

	return (this.processInst(request, part, parts, params, callback));
};

caConfigHttp.prototype.sendResponse = function (request, response, code, data,
    headers)
{
	var rspdata;

	if (!headers)
		headers = {};

	headers['Access-Control-Allow-Origin'] = '*';
	headers['Access-Control-Allow-Methods'] = 'POST, GET, DELETE';
	response.writeHead(code, headers);

	if (!data)
		rspdata = '';
	else if (typeof (data) == typeof (''))
		rspdata = data;
	else
		rspdata = JSON.stringify(data);

	if (code >= HTTP.EBADREQUEST)
		this.cah_log.dbg('failed: ' + request.method + ' ' +
		    request.url + ': ' + data);

	response.end(rspdata);
};

caConfigHttp.prototype.createInst = function (request, params, reqdata,
    callback)
{
	var instspec;

	if (request.method != 'POST') {
		callback(HTTP.EBADMETHOD, HTTP.MSG_EBADMETHOD,
		    { 'Allow': 'POST' });
		return;
	}

	if (request.headers['content-type'] !=
	    'application/x-www-form-urlencoded') {
		try {
			instspec = JSON.parse(reqdata);
		} catch (ex) {
			callback(HTTP.EBADREQUEST,
			    'error: failed to parse JSON: ' + ex.message);
			return;
		}
	} else {
		instspec = {};

		if ('module' in params)
			instspec['module'] = HTTP.oneParam(params, 'module');
		if ('stat' in params)
			instspec['stat'] = HTTP.oneParam(params, 'stat');
		if ('predicate' in params)
			instspec['predicate'] = params['predicate'];
		if ('decomposition' in params)
			instspec['decomposition'] = [ params['decomposition'] ];
		if ('nodes' in params)
			instspec['nodes'] = params['nodes'];
	}

	try {
		this.emit('inst-create', { spec: instspec }, callback);
	} catch (ex) {
		callback(HTTP.ESERVER,
		    'error: failed to create instrumentation: ' + ex.message);
	}
};

caConfigHttp.prototype.processInst = function (request, instid, uri, params,
    callback)
{
	if (uri.length === 0) {
		if (request.method != 'DELETE') {
			callback(HTTP.EBADMETHOD, HTTP.MSG_EBADMETHOD,
			    { 'Allow': 'DELETE' });
			return;
		}

		this.emit('inst-delete', { instid: instid }, callback);
		return;
	}

	if (uri.length > 1) {
		callback(HTTP.ENOTFOUND,
		    'error: requested resource was not found');
		return;
	}

	switch (uri[0]) {
	case 'value':
		if (request.method != 'GET') {
			callback(HTTP.EBADMETHOD, HTTP.MSG_EBADMETHOD,
			    { 'Allow': 'GET' });
			return;
		}

		params.instid = instid;
		this.emit('inst-value', params, callback);
		break;

	default:
		callback(HTTP.ENOTFOUND,
		    'error: requested resource was not found');
		break;
	}
};

caConfigHttp.prototype.listMetrics = function (callback)
{
	this.emit('list-metrics', callback);
};
