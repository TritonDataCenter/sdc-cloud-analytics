/*
 * ca-svc-stash.js: implementation of persistence service
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('./ca-common');
var mod_calog = require('./ca-log');
var mod_cap = require('./ca-amqp-cap');
var mod_persist = require('./ca-persist');

var ps_name = 'stashsvc';	/* component name */
var ps_vers = '0.0';		/* component version */

function caStashService(argv, loglevel)
{
	var svc, dbg_log;

	svc = this;

	if (arguments.length < 2)
		loglevel = mod_calog.caLog.DBG;

	this.ps_log = new mod_calog.caLog({
		out: process.stdout,
		level: loglevel
	});

	if (argv.length < 1)
		throw (new caError(ECA_INVAL, null,
		    'service requires an argument'));

	this.ps_stash_dir = argv[0];

	if (argv.length > 1) {
		dbg_log = mod_calog.caLogFromFile(argv[1],
		    { candrop: true }, mod_calog.caLogError(this.ps_log));
		this.ps_log.info('Logging AMQP debug messages to "%s"',
		    argv[1]);
	}

	this.ps_name = ps_name;
	this.ps_vers = ps_vers;
	this.ps_sysinfo = mod_ca.caSysinfo(this.ps_name, this.ps_vers);
	this.ps_stash = new mod_persist.caStash(this.ps_log, this.ps_sysinfo);
	this.ps_queue = mod_cap.ca_amqp_key_base_stash +
	    this.ps_sysinfo.ca_hostname;

	this.ps_cap = new mod_cap.capAmqpCap({
	    dbglog: dbg_log,
	    keepalive: true,
	    log: this.ps_log,
	    queue: this.ps_queue,
	    sysinfo: this.ps_sysinfo
	});

	this.ps_cap.bind(mod_cap.ca_amqp_key_all);
	this.ps_cap.bind(mod_cap.ca_amqp_key_stash);

	this.ps_cap.on('msg-cmd-status', this.cmdStatus.bind(this));
	this.ps_cap.on('msg-cmd-data_put', this.cmdDataPut.bind(this));
	this.ps_cap.on('msg-cmd-data_get', this.cmdDataGet.bind(this));
	this.ps_cap.on('msg-notify-configsvc_online', function () {
		svc.ps_log.info('configsvc restarted');
	});
}

caStashService.prototype.routekey = function ()
{
	return (this.ps_queue);
};

caStashService.prototype.start = function (callback)
{
	var svc = this;

	ASSERT(this.ps_startcb === undefined);

	this.ps_log.info('Stasher starting up (%s/%s)',
	    this.ps_name, this.ps_vers);
	this.ps_log.info('%-12s %s', 'Hostname:', this.ps_sysinfo.ca_hostname);
	this.ps_log.info('%-12s %s', 'AMQP broker:',
	    JSON.stringify(this.ps_cap.broker()));
	this.ps_log.info('%-12s %s', 'Routing key:', this.ps_queue);
	this.ps_log.info('%-12s %s', 'Stash:', this.ps_stash_dir);
	this.ps_startcb = callback;

	this.ps_stash.init(this.ps_stash_dir, function (err) {
		if (err)
			return (callback(err));

		svc.ps_cap.on('connected', function () {
			if (svc.ps_startcb) {
				svc.ps_startcb();
				svc.ps_startcb = undefined;
			}
		});

		return (svc.ps_cap.start());
	});
};

caStashService.prototype.stop = function (callback)
{
	var svc = this;

	ASSERT(this.ps_stopcb === undefined);
	this.ps_stopcb = callback;

	this.ps_cap.on('disconnected', function () {
		if (svc.ps_stopcb) {
			svc.ps_stopcb();
			svc.ps_stopcb = undefined;
		}
	});

	this.ps_cap.stop();
};

caStashService.prototype.cmdStatus = function (msg)
{
	/* XXX flesh out info on recent activity */
	var sendmsg = {};
	sendmsg.s_component = 'stash';
	sendmsg.s_rootdir = this.ps_stash_dir;
	this.ps_cap.sendCmdAckStatus(msg.ca_source, msg.ca_id, sendmsg);
};

caStashService.prototype.cmdDataGet = function (msg)
{
	var svc, stash, tasks;

	svc = this;
	stash = this.ps_stash;
	tasks = msg.p_requests.map(function (obj) {
		return (function (callback) {
			stash.bucketContents(obj['bucket'], callback);
		});
	});

	caRunParallel(tasks, function (rv) {
		var results = caSerializeResults(rv);
		svc.ps_cap.sendCmdAckDataGet(msg.ca_source, msg.ca_id, results);
	});
};

caStashService.prototype.cmdDataPut = function (msg)
{
	var svc, stash, tasks;

	svc = this;
	stash = this.ps_stash;
	tasks = msg.p_requests.map(function (obj) {
		return (function (callback) {
			stash.bucketFill(obj['bucket'], obj['metadata'],
			    obj['data'], callback);
		});
	});

	caRunParallel(tasks, function (rv) {
		var results = caSerializeResults(rv);
		svc.ps_cap.sendCmdAckDataPut(msg.ca_source, msg.ca_id, results);
	});
};

function caSerializeResults(rv)
{
	return (rv['results'].map(function (elt) {
		if (!('error' in elt))
			return (elt);

		return ({
		    error: {
			code: elt['error'].code(),
			message: elt['error'].message
		    }
		});
	}));
}

exports.caStashService = caStashService;
