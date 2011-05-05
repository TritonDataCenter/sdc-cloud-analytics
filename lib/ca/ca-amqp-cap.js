/*
 * ca-amqp-cap.js: Cloud Analytics Protocol: constants, functions, and objects
 *    for interactions involving the CA AMQP protocol.
 */

var mod_sys = require('sys');
var mod_events = require('events');
var ASSERT = require('assert').ok;

var mod_ca = require('./ca-common');
var mod_caerr = require('./ca-error');
var mod_caamqp = require('./ca-amqp');

/*
 * If someone has specified the CA_AMQP_PREFIX, we should use that in the
 * construction of all of our amqp routing keys.
 */
var amqp_prefix = '';
if (process.env['CA_AMQP_PREFIX'])
	amqp_prefix = process.env['CA_AMQP_PREFIX'] + '.';

/*
 * If configured, we may ping ourselves at the specified interval to detect
 * rabbitmq broker disconnection.
 */
var ca_amqp_ping_interval		= 30 * 1000;	/* 30s */

/*
 * The Cloud Analytics API is versioned with a major and minor number.  Software
 * components should ignore messages received with a newer major version number.
 */
exports.ca_amqp_vers_major		= 2;
exports.ca_amqp_vers_minor		= 3;

/*
 * We use only one global exchange of type 'topic'.
 */
exports.ca_amqp_exchange 		= 'amq.topic';
exports.ca_amqp_exchange_opts		= { type: 'topic' };

/*
 * Services on the AMQP network (config service, aggregators, and instrumenters)
 * each create their own key which encodes their type and a unique identifier
 * (usually hostname).
 */
exports.ca_amqp_key_base_aggregator	= amqp_prefix + 'ca.aggregator.';
exports.ca_amqp_key_base_config		= amqp_prefix + 'ca.config.';
exports.ca_amqp_key_base_instrumenter	= amqp_prefix + 'ca.instrumenter.';
exports.ca_amqp_key_base_tool		= amqp_prefix + 'ca.tool.';
exports.ca_amqp_key_base_stash		= amqp_prefix + 'ca.stash.';

/*
 * To facilitate autoconfiguration, each component only needs to know about this
 * global config key.  Upon startup, a component sends a message to this key.
 * The configuration service receives these messages and responds with any
 * additional configuration data needed for this component.
 */
exports.ca_amqp_key_config 		= amqp_prefix + 'ca.config';

/*
 * Similarly, there is only one persistence service.
 */
exports.ca_amqp_key_stash		= amqp_prefix + 'ca.stash';

/*
 * On startup, the configuration service broadcasts to everyone to let them know
 * that it has (re)started.
 */
exports.ca_amqp_key_all			= amqp_prefix + 'ca.broadcast';

/*
 * Each instrumentation gets its own key, which exactly one aggregator
 * subscribes to.  This facilitates distribution of instrumentation data
 * processing across multiple aggregators.
 */
var ca_amqp_key_base_instrumentation = amqp_prefix + 'ca.instrumentation.';

function caRouteKeyForInst(id)
{
	return (ca_amqp_key_base_instrumentation + id);
}

function caIncompatible(msg)
{
	return (msg.ca_major !== exports.ca_amqp_vers_major);
}

/*
 * Returns the AMQP broker configuration based on the environment.
 */
function caBroker()
{
	var broker;

	if (!process.env['AMQP_HOST'])
		throw (new Error('AMQP_HOST not specified'));

	broker = {};
	broker.host = process.env['AMQP_HOST'];

	if (process.env['AMQP_LOGIN'])
		broker.login = process.env['AMQP_LOGIN'];
	if (process.env['AMQP_PASSWORD'])
		broker.password = process.env['AMQP_PASSWORD'];
	if (process.env['AMQP_VHOST'])
		broker.vhost = process.env['AMQP_VHOST'];
	if (process.env['AMQP_PORT'])
		broker.port = process.env['AMQP_PORT'];

	return (broker);
}

/*
 * This structure describes all known message types and subtypes.  Message types
 * with no subtype object have no subtypes.  The value at each subtype is a
 * function for further processing.
 */
var capMessageTypes = {
	cmd: {
	    disable_instrumentation: capDispatch,
	    enable_instrumentation: capDispatch,
	    enable_aggregation: capDispatch,
	    ping: capValidate,
	    status: capValidate,
	    abort: capValidate,
	    data_get: capValidate,
	    data_put: capValidate
	},
	ack: {
	    disable_instrumentation: capDispatch,
	    enable_instrumentation: capDispatch,
	    enable_aggregation: capDispatch,
	    ping: capValidate,
	    status: capValidate,
	    abort: capValidate,
	    data_get: capValidate,
	    data_put: capValidate
	},
	notify: {
	    aggregator_online: capValidate,
	    configsvc_online: capValidate,
	    config_reset: capValidate,
	    instrumenter_error: capDispatch,
	    instrumenter_online: capValidate,
	    log: capValidate
	},
	data: capDispatch
};

function capValidate(cap, msg)
{
	if (caIncompatible(msg)) {
		cap.cap_log.warn('dropped message with incompatible ' +
		    'version: %j', msg);
		return;
	}

	capDispatch(cap, msg);
}

function capDispatch(cap, msg)
{
	var eventname;

	if (msg.ca_type == 'ack' && cap.ack(msg))
		return (undefined);

	eventname = 'msg-' + msg.ca_type;

	if ('ca_subtype' in msg)
		eventname += '-' + msg.ca_subtype;

	if (eventname == 'msg-cmd-ping')
		return (cap.sendCmdAckPing(msg.ca_source, msg.ca_id));

	if (eventname == 'msg-cmd-abort') {
		cap.sendCmdAckAbort(msg.ca_source, msg.ca_id, true);
		return (caPanic('panic due to remote request'));
	}

	/* Ignore keepalive ping returns. */
	if (eventname == 'msg-ack-ping' && msg.ca_source == cap.cap_source)
		return (undefined);

	if (cap.listeners(eventname).length === 0)
		cap.cap_log.warn('dropped ignored message of type "%s": %j',
		    eventname, msg);

	return (cap.emit(eventname, msg));
}

/*
 * The capAmqpCap class is the primary interface to the CA AMQP protocol.  CA
 * services use this object to communicate with other CA services using the CA
 * AMQP protocol via the AMQP broker.  This class wraps an instance of caAmqp
 * (which maintains the connection to the AMQP broker) and provides higher-level
 * interfaces for sending commands and other messages and receiving messages.
 * This class takes care of validating incoming messages.  The 'args'
 * constructor argument must specify the following members:
 *
 *	log		logger for recording debug messages
 *
 *	queue		queue name for this component
 *
 *	sysinfo		Object specifying ca_major, ca_minor, ca_hostname,
 *			ca_agent_name, ca_agent_version, ca_os_name,
 *			ca_os_release, ca_os_revision
 *
 * and may specify the following members:
 *
 *	broker		AMQP broker configuration (default: see caBroker)
 *
 *	dbglog		Print debug information for each message sent and
 *			received to the specified log (default: no log)
 *
 *	exchange	AMQP exchange name (default: CA default)
 *
 *	exchange_opts	AMQP exchange options (default: CA default)
 *
 *	keepalive	If true, automatically ping self at some interval to
 *			keep the broker connection alive.  (default: false)
 *
 *	retry_interval	See caAmqp (default: see caAmqp)
 *
 *	retry_limit	See caAmqp (default: see caAmqp)
 */
function capAmqpCap(args)
{
	var amqpconf;

	this.cap_dbglog = args['dbglog'];
	this.cap_broker = args['broker'] || caBroker();
	this.cap_log = mod_ca.caFieldExists(args, 'log');
	this.cap_sysinfo = mod_ca.caFieldExists(args, 'sysinfo', {});
	this.cap_source = mod_ca.caFieldExists(args, 'queue', '');
	this.cap_keepalive = args['keepalive'] || false;
	this.cap_ping_interval = ca_amqp_ping_interval;

	this.cap_cmds = {};
	this.cap_cmdid = 0;

	amqpconf = {
	    broker: this.cap_broker,
	    exchange: args['exchange'] || exports.ca_amqp_exchange,
	    exchange_opts: args['exchange_opts'] || exports.ca_amqp_exchange,
	    log: this.cap_log,
	    queue: this.cap_source
	};

	if ('retry_interval' in args)
		amqpconf['retry_interval'] = args['retry_interval'];

	if ('retry_limit' in args)
		amqpconf['retry_limit'] = args['retry_limit'];

	this.cap_amqp = new mod_caamqp.caAmqp(amqpconf);
	this.cap_amqp.on('connected', this.connected.bind(this));
	this.cap_amqp.on('disconnected', this.disconnected.bind(this));
	this.cap_amqp.on('amqp-error', this.error.bind(this));
	this.cap_amqp.on('amqp-fatal', this.fatal.bind(this));
	this.cap_amqp.on('msg', this.receive.bind(this));
}

mod_sys.inherits(capAmqpCap, mod_events.EventEmitter);

capAmqpCap.prototype.queue = function ()
{
	return (this.cap_source);
};

capAmqpCap.prototype.info = function ()
{
	return ({
	    amqp: this.cap_amqp.info(),
	    cmds: caDeepCopy(this.cap_cmds)
	});
};

capAmqpCap.prototype.broker = function ()
{
	return (caDeepCopy(this.cap_broker));
};

/*
 * Connect to the AMQP broker.
 */
capAmqpCap.prototype.start = function ()
{
	this.cap_amqp.start();
};

/*
 * Disconnect from the AMQP broker.
 */
capAmqpCap.prototype.stop = function ()
{
	this.cap_amqp.stop();
};

/*
 * [internal] Invoked whenever the underlying AMQP object reconnects.  If this
 * is the first time through, we invoke our consumer's callback (supplied when
 * they called start() to kick off the connect process).
 */
capAmqpCap.prototype.connected = function ()
{
	if (this.cap_retrying) {
		this.cap_log.warn('RESOURCE_LOCKED error on queue "%s" ' +
		    'cleared after ping', this.cap_source);
		this.cap_retrying = false;
	}

	this.emit('connected');
	ASSERT(!this.cap_toid);
	this.setTimeout();
};

capAmqpCap.prototype.disconnected = function ()
{
	if (this.cap_toid) {
		clearTimeout(this.cap_toid);
		this.cap_toid = undefined;
	}

	this.emit('disconnected');
};

capAmqpCap.prototype.tick = function ()
{
	this.sendCmdPing(this.cap_source, 'ticker');
	this.setTimeout();
};

capAmqpCap.prototype.setTimeout = function ()
{
	if (!this.cap_keepalive)
		return;

	this.cap_toid = setTimeout(
	    this.tick.bind(this), this.cap_ping_interval);
};

/*
 * [internal] Invoked when the underlying AMQP object encounters an error.
 */
capAmqpCap.prototype.error = function (err)
{
	var cap = this;
	var log = this.cap_log;
	var exn;

	if (this.cap_retrying) {
		/*
		 * We've failed again after attempting to clear a
		 * RESOURCE_LOCKED error.  Give up and emit the error as fatal.
		 */
		log.warn('re-emitting error code "%s" on queue "%s" ' +
		    '(failed on retry after ping)', err.code, this.cap_source);
		this.cap_retrying = false;
		return (this.fatal(err));
	}

	/*
	 * The only error we can do anything about is RESOURCE_LOCKED.  All
	 * other non-fatal errors are handled by the lower layer and are only
	 * emitted for reporting purposes.
	 */
	if (err.code != mod_caamqp.RESOURCE_LOCKED) {
		exn = new caError(ECA_REMOTE, null,
		    'amqp error "%s": %s', err.code, err.message);

		if (this.listeners('amqp-error').length === 0)
			log.warn('%r', exn);

		return (this.emit('amqp-error', exn));
	}

	/*
	 * We seem to not be able to get the exclusive lock for our queue.  This
	 * may be because we came down hard (that is, without orderly
	 * disconnects) and we have stale connection state at the AMQP server.
	 * If this is the case, sending anything to the queue will cause the
	 * connection state to reset and the exclusive lock on the queue to be
	 * released.  We therefore send a ping message (not caring about the
	 * response), wait ten seconds, and restart again.
	 */
	this.cap_retrying = true;
	log.warn('sending ping to queue "%s" after receiving RESOURCE_LOCKED',
	    this.cap_source);
	this.sendCmdPing(this.cap_source, 1);
	cap.cap_amqp.stop();

	return (setTimeout(function () {
		log.warn('reattempting bind to queue "%s" after ping',
		    cap.cap_source);

		cap.cap_amqp.start();
	}, 10000));
};

/*
 * [internal] Invoked when the underlying AMQP object encounters a fatal error.
 */
capAmqpCap.prototype.fatal = function (err)
{
	var exn = new caError(ECA_REMOTE, null,
	    'amqp fatal error "%s": %s', err.code, err.message);
	this.cap_dead = true;

	if (this.listeners('fatal').length === 0)
		caPanic('fatal amqp error', exn);

	this.emit('fatal', exn);
};

/*
 * [internal] Invoked when the underlying AMQP object receives a message.
 * Validate it and emit the corresponding event for our consumer.
 */
capAmqpCap.prototype.receive = function (msg)
{
	var type, subtype;
	var log = this.cap_log;

	ASSERT(!this.cap_dead);
	this.cap_last_received = msg;

	if (!('ca_type') in msg) {
		log.warn('dropped message with unspecified type: %j', msg);
		return;
	}

	type = msg.ca_type;

	if (!(type in capMessageTypes)) {
		log.warn('dropped message with unknown type: %j', msg);
		return;
	}

	if (typeof (capMessageTypes[type]) == typeof (arguments.callee)) {
		capMessageTypes[type](this, msg);
		return;
	}

	if (type == 'cmd' && !('ca_id' in msg)) {
		log.warn('dropped cmd message with no id: %j', msg);
		return;
	}

	if (!('ca_time' in msg)) {
		log.warn('dropped message with unspecified time: %j', msg);
		return;
	}

	if (!('ca_hostname' in msg)) {
		log.warn('dropped message with unspecified hostname: %j', msg);
		return;
	}

	if (!('ca_source' in msg)) {
		log.warn('dropped message with unspecified source: %j', msg);
		return;
	}

	if (!('ca_subtype' in msg)) {
		log.warn('dropped message with unspecified subtype: %j', msg);
		return;
	}

	subtype = msg.ca_subtype;

	if (!(subtype in capMessageTypes[type])) {
		log.warn('dropped message with unknown subtype: %j', msg);
		return;
	}

	if (this.cap_dbglog)
		this.cap_dbglog.dbg('component %s received %s/%s: %j',
		    this.cap_source, type, subtype, msg);

	capMessageTypes[type][subtype](this, msg);
};

/*
 * [internal] Common routine for sending messages that automatically fills in
 * appropriate common fields.  This implementation has nasty knowledge of the
 * protocol, but then again that's what this module is for.
 */
capAmqpCap.prototype.send = function (routekey, msg)
{
	var type, subtype;
	var sendmsg;

	ASSERT(!this.cap_dead, 'cannot send after fatal error');

	type = mod_ca.caFieldExists(msg, 'ca_type', '');
	sendmsg = mod_ca.caDeepCopy(msg);
	sendmsg.ca_source = this.cap_source;
	sendmsg.ca_hostname = this.cap_sysinfo.ca_hostname;

	if (!('ca_time' in msg))
		sendmsg.ca_time = new Date();

	if (typeof (capMessageTypes[type]) == 'function') {
		this.cap_amqp.send(routekey, sendmsg);
		return;
	}

	subtype = mod_ca.caFieldExists(msg, 'ca_subtype', '');

	/*
	 * This is particularly unholy -- we're leveraging the knowledge that
	 * capValidate is used to check received messages for the additional
	 * sysinfo fields, so if we're sending one of these messages then we'd
	 * better make sure to include them.
	 */
	if (capMessageTypes[type][subtype] == capValidate)
		mod_ca.caDeepCopyInto(sendmsg, this.cap_sysinfo);

	if (this.cap_dbglog)
		this.cap_dbglog.dbg('component %s sending %s/%s to %s: %j',
		    this.cap_source, type, subtype, routekey, sendmsg);

	this.cap_amqp.send(routekey, sendmsg);
};

/*
 * Bind to the named queue.  Invoke "callback" when complete.
 */
capAmqpCap.prototype.bind = function (routekey, callback)
{
	ASSERT(!this.cap_dead, 'cannot bind after fatal error');
	this.cap_amqp.bind(routekey, function () {
		if (callback)
			callback();
	});
};

/*
 * The send* family of functions are wrappers around the Cloud Analytics private
 * AMQP protocol that format and send protocol messages based on the given
 * arguments.  The first argument to each function is the destination routing
 * key.  Note that we have split out the ack-failure functions representing a
 * "missing argument" error from those representing other failure modes.
 */
capAmqpCap.prototype.sendNotifyCfgOnline = function (route)
{
	var msg = {};

	msg.ca_type = 'notify';
	msg.ca_subtype = 'configsvc_online';
	this.send(route, msg);
};

capAmqpCap.prototype.sendNotifyCfgReset = function (route)
{
	var msg = {};

	msg.ca_type = 'notify';
	msg.ca_subtype = 'config_reset';
	this.send(route, msg);
};

capAmqpCap.prototype.sendNotifyInstOnline = function (route, metadata)
{
	var msg = {};

	msg.ca_type = 'notify';
	msg.ca_subtype = 'instrumenter_online';
	msg.ca_modules = [];
	msg.ca_metadata = metadata;
	this.send(route, msg);
};

capAmqpCap.prototype.sendNotifyAggOnline = function (route, ip, port, trans)
{
	var msg = {};

	ASSERT(port);
	msg.ca_type = 'notify';
	msg.ca_subtype = 'aggregator_online';
	msg.ag_http_ipaddr = ip;
	msg.ag_http_port = port;
	msg.ag_transformations = trans;
	this.send(route, msg);
};

/*
 * key is the unique routing key for this instrumentation
 * dim corresponds to the number of dimensions that we are using
 * the fields for inst should match the HTTP spec
 */
capAmqpCap.prototype.sendCmdEnableAgg = function (route, id, aggId, key,
    inst)
{
	var msg = {};

	msg.ca_id = id;
	msg.ca_type = 'cmd';
	msg.ca_subtype = 'enable_aggregation';
	msg.ag_inst_id = aggId;
	msg.ag_key = key;
	msg.ag_instrumentation = inst;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckEnableAggSuc = function (route, id, instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'enable_aggregation';
	msg.ca_id = id;
	msg.ag_inst_id = instId;
	msg.ag_status = 'enabled';
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckEnableAggFail = function (route, id, error,
	instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'enable_aggregation';
	msg.ca_id = id;
	if (instId)
		msg.ag_inst_id = instId;
	msg.ag_status = 'enable_failed';
	if (error)
		msg.ag_error = error;
	this.send(route, msg);
};

/*
 * spec is the struct that corresponds to the following information:
 *  - modname
 *  - statname
 *  - decomp
 *  - predicate
 */
capAmqpCap.prototype.sendCmdEnableInst = function (route, id, instId, key, spec,
    zones)
{
	var msg = {};

	msg.ca_id = id;
	msg.ca_type = 'cmd';
	msg.ca_subtype = 'enable_instrumentation';
	msg.is_inst_key = key;
	msg.is_inst_id = instId;
	msg.is_module = spec.modname;
	msg.is_stat = spec.statname;
	msg.is_predicate = spec.pred;
	msg.is_decomposition = spec.decomp;
	msg.is_granularity = spec.granularity;

	if (zones)
		msg.is_zones = zones;

	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckEnableInstSuc = function (route, id, instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'enable_instrumentation';
	msg.ca_id = id;
	msg.is_inst_id = instId;
	msg.is_status = 'enabled';
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckEnableInstFail = function (route, id, error,
	instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'enable_instrumentation';
	msg.ca_id = id;
	if (instId)
		msg.is_inst_id = instId;
	msg.is_status = 'enable_failed';
	if (error)
		msg.is_error = error;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdDisableInst = function (route, id, instId)
{
	var msg = {};

	msg.ca_id = id;
	msg.ca_type = 'cmd';
	msg.ca_subtype = 'disable_instrumentation';
	msg.is_inst_id = instId;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckDisableInstFail = function (route, id, error,
	instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'disable_instrumentation';
	msg.ca_id = id;
	msg.is_status = 'disable_failed';
	if (error)
		msg.is_error = error;
	if (instId)
		msg.is_inst_id = instId;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckDisableInstSuc = function (route, id, instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'disable_instrumentation';
	msg.ca_id = id;
	msg.is_status = 'disabled';
	msg.is_inst_id = instId;
	this.send(route, msg);
};

capAmqpCap.prototype.sendData = function (route, instId, value, time)
{
	var msg = {};

	msg.ca_type = 'data';
	msg.d_inst_id = instId;
	msg.d_value = value;
	msg.d_time = time;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAbort = function (route, id)
{
	var msg = {};

	msg.ca_type = 'cmd';
	msg.ca_subtype = 'abort';
	msg.ca_id = id;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckAbort = function (route, id, ok)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'abort';
	msg.ca_id = id;
	msg.a_ok = ok;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdPing = function (route, id)
{
	var msg = {};

	msg.ca_type = 'cmd';
	msg.ca_subtype = 'ping';
	msg.ca_id = id;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckPing = function (route, id)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'ping';
	msg.ca_id = id;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdStatus = function (route, id)
{
	var msg = {};

	msg.ca_type = 'cmd';
	msg.ca_subtype = 'status';
	msg.ca_id = id;
	this.send(route, msg);
};

/*
 * Data is an object that corresponds to the per-component specific data.
 */
capAmqpCap.prototype.sendCmdAckStatus = function (route, id, data)
{
	var msg = mod_ca.caDeepCopy(data);

	msg.ca_type = 'ack';
	msg.ca_subtype = 'status';
	msg.ca_id = id;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdDataPut = function (route, id, data)
{
	var msg = {};
	msg.ca_type = 'cmd';
	msg.ca_subtype = 'data_put';
	msg.ca_id = id;
	msg.p_requests = data;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckDataPut = function (route, id, data)
{
	var msg = {};
	msg.ca_type = 'ack';
	msg.ca_subtype = 'data_put';
	msg.ca_id = id;
	msg.p_results = data;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdDataGet = function (route, id, data)
{
	var msg = {};
	msg.ca_type = 'cmd';
	msg.ca_subtype = 'data_get';
	msg.ca_id = id;
	msg.p_requests = data;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckDataGet = function (route, id, data)
{
	var msg = {};
	msg.ca_type = 'ack';
	msg.ca_subtype = 'data_get';
	msg.ca_id = id;
	msg.p_results = data;
	this.send(route, msg);
};

capAmqpCap.prototype.sendNotifyLog = function (route, message)
{
	var msg = {};

	msg.ca_type = 'notify';
	msg.ca_subtype = 'log';
	msg.l_message = message;
	this.send(route, msg);
};

capAmqpCap.prototype.sendNotifyInstError = function (route, instId, error,
	status)
{
	var msg = {};

	msg.ca_type = 'notify';
	msg.ca_subtype = 'instrumenter_error';
	msg.ins_inst_id = instId;
	msg.ins_error = error;
	msg.ins_status = status;
	this.send(route, msg);
};

/*
 * The cmd* family of functions provide a higher-level interface for sending
 * command messages and receiving the corresponding ack.  Most consumers should
 * use these functions rather than sending and receiving the raw messages
 * directly.  Each of these functions takes a destination route key, a timeout
 * value, a callback to be invoked as (err, rv) when the command either
 * completes or times out, and zero or more command- specific arguments.  Some
 * commands like ping have no "rv".
 */
capAmqpCap.prototype.cmdAbort = function (route, timeout, callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, function (err, msg) {
		if (err)
			return (callback(err));

		if (!msg.a_ok)
			return (callback(new caError(ECA_REMOTE,
			    null, 'failed to abort remote service')));

		return (callback(null));
	});

	this.sendCmdAbort(route, cmdid);
};

capAmqpCap.prototype.cmdPing = function (route, timeout, callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, callback);
	this.sendCmdPing(route, cmdid);
};

capAmqpCap.prototype.cmdStatus = function (route, timeout, callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, callback);
	this.sendCmdStatus(route, cmdid);
};

capAmqpCap.prototype.cmdDataGet = function (route, timeout, requests, callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, function (err, msg) {
		if (err)
			return (callback(err));

		return (callback(null, msg.p_results));
	});
	this.sendCmdDataGet(route, cmdid, requests);
};

capAmqpCap.prototype.cmdDataPut = function (route, timeout, requests, callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, function (err, msg) {
		if (err)
			return (callback(err));

		return (callback(null, msg.p_results));
	});
	this.sendCmdDataPut(route, cmdid, requests);
};

capAmqpCap.prototype.cmdEnableAgg = function (route, instid, instkey, props,
    timeout, callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, function (err, msg) {
		if (err)
			return (callback(err));

		if (msg.ag_status != 'enabled')
			return (callback(new caError(ECA_REMOTE, null,
			    'failed to enable aggregator')));

		return (callback(null, true));
	});

	this.sendCmdEnableAgg(route, cmdid, instid, instkey, props);
};

capAmqpCap.prototype.cmdEnableInst = function (route, instid, instkey, props,
    zones, timeout, callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, function (err, msg) {
		if (err)
			return (callback(err));

		if (msg.is_status != 'enabled')
			return (callback(new caError(ECA_REMOTE, null,
			    'failed to enable instrumenter: %s',
			    msg.is_error)));

		return (callback(null, true));
	});

	this.sendCmdEnableInst(route, cmdid, instid, instkey, {
	    modname: props['module'],
	    statname: props['stat'],
	    pred: props['predicate'],
	    decomp: props['decomposition'],
	    granularity: props['granularity']
	}, zones);
};

capAmqpCap.prototype.cmdDisableInst = function (route, instid, timeout,
    callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, function (err, msg) {
		if (err)
			return (callback(err));

		if (msg.is_status != 'disabled')
			return (callback(new caError(ECA_REMOTE, null,
			    'failed to disable instrumenter: %s',
			    msg.is_error)));

		return (callback(null, true));
	});

	this.sendCmdDisableInst(route, cmdid, instid);
};

/*
 * [private] Returns an id used to send a new command.  The callback will be
 * invoked when that command returns.
 */
capAmqpCap.prototype.cmd = function (timeout, callback)
{
	var id, tid;
	var cap = this;

	/*
	 * Our ID scheme is pretty simple: "auto" plus a monotonically
	 * increasing number.  We could have different numbers based on the
	 * hostname, but we don't bother.  All that really matters is that it be
	 * unique, and particularly that it not overlap with those that might be
	 * used by another consumer of this object sending raw commands.
	 */
	id = 'auto.' + this.cap_cmdid++;
	this.cap_cmds[id] = function (msg) {
		if (timeout)
			clearTimeout(tid);
		callback(null, msg);
	};

	if (!timeout)
		return (id);

	tid = setTimeout(function () {
		delete (cap.cap_cmds[id]);
		callback(new caError(ECA_TIMEDOUT));
	}, timeout);
	return (id);
};

/*
 * [private] Invoked when we receive an "ack" message.  If this corresponds to a
 * command we sent out, invoke our own callback and return true to indicate that
 * we consumed this message.  Otherwise our caller will pass it on to another
 * consumer.
 */
capAmqpCap.prototype.ack = function (msg)
{
	var id;

	ASSERT(msg.ca_type == 'ack');

	if (!('ca_id' in msg))
		return (false);

	id = msg.ca_id;

	if (!(id in this.cap_cmds))
		return (false);

	this.cap_cmds[id](msg);
	delete (this.cap_cmds[id]);
	return (true);
};

exports.capAmqpCap = capAmqpCap;
exports.caRouteKeyForInst = caRouteKeyForInst;
