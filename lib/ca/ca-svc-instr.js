/*
 * ca-svc-instr.js: CA instrumenter implementation
 */

var mod_assert = require('assert');
var mod_sys = require('sys');
var mod_events = require('events');

var mod_ca = require('./ca-common');
var mod_cap = require('./ca-amqp-cap');
var mod_log = require('./ca-log');
var mod_capred = require('./ca-pred');
var mod_md = require('./ca-metadata');
var mod_metric = require('./ca-metric');
var mod_instr = require('./ca-instr');

function caInstrService(argv, out, backends)
{
	var mdpath;

	this.ins_backends = caDeepCopy(backends);
	this.ins_name = 'instsvc';
	this.ins_vers = '0.0';
	this.ins_granularity_max = mod_ca.ca_granularity_min;
	this.ins_instns = {};
	this.ins_impls = {};
	this.ins_status_callbacks = {};

	this.ins_sysinfo = mod_ca.caSysinfo(this.ins_name, this.ins_vers);
	this.ins_queue = mod_cap.ca_amqp_key_base_instrumenter +
	    this.ins_sysinfo.ca_hostname;

	this.ins_log = new mod_log.caLog({ out: out });

	mod_assert.ok(argv.length > 0);
	mdpath = argv[0];

	if (argv.length > 1) {
		this.ins_dbglog = mod_log.caLogFromFile(argv[1],
		    { candrop: true }, mod_log.caLogError(this.ins_log));
		this.ins_log.info('Logging AMQP message to "%s"', argv[1]);
	}

	this.ins_cap = new mod_cap.capAmqpCap({
	    dbglog: this.ins_dbglog,
	    keepalive: true,
	    log: this.ins_log,
	    queue: this.ins_queue,
	    sysinfo: this.ins_sysinfo
	});

	this.ins_cap.bind(mod_cap.ca_amqp_key_all);
	this.ins_cap.on('msg-cmd-status',
	    this.amqpStatus.bind(this));
	this.ins_cap.on('msg-notify-configsvc_online',
	    this.amqpCfgOnline.bind(this));
	this.ins_cap.on('msg-notify-config_reset',
	    this.amqpCfgReset.bind(this));
	this.ins_cap.on('msg-cmd-enable_instrumentation',
	    this.amqpEnableInstn.bind(this));
	this.ins_cap.on('msg-cmd-disable_instrumentation',
	    this.amqpDisableInstn.bind(this));

	this.ins_mdmgr = new mod_md.caMetadataManager(
	    this.ins_log, mdpath);
}

caInstrService.prototype.routekey = function ()
{
	return (this.ins_queue);
};

caInstrService.prototype.start = function (callback)
{
	var svc, log;

	this.ins_start = new Date().getTime();

	svc = this;
	log = this.ins_log;
	log.info('Instrumenter starting up (%s/%s)', this.ins_name,
	    this.ins_vers);
	log.info('%-12s %s', 'Hostname:', this.ins_sysinfo.ca_hostname);
	log.info('%-12s %s', 'AMQP broker:',
	    JSON.stringify(this.ins_cap.broker()));
	log.info('%-12s %s', 'Routing key:', this.ins_queue);

	this.ins_mdmgr.load(function (err) {
		if (err) {
			callback(new caError(err.code(), err,
			    'failed to start server'));
			return;
		}

		svc.ins_metadata_raw = svc.ins_mdmgr.get('metric', 'metrics');
		svc.ins_metadata = new mod_metric.caMetricMetadata();
		svc.ins_metadata.addFromHost(svc.ins_metadata_raw,
		    'metrics.json');

		svc.ins_metrics_global = svc.ins_metadata.metricSet();
		svc.ins_metrics_impl = new mod_metric.caMetricSet();

		svc.initBackends(function () {
			svc.ins_starter = callback;
			svc.ins_cap.on('connected', svc.initFini.bind(svc));
			svc.ins_cap.start();
		});
	});
};

/*
 * Search for installed backend plugins and load them.
 */
caInstrService.prototype.initBackends = function (callback)
{
	/*
	 * Preference between different backends (determined by how expensive
	 * they are to use) is implicitly defined by the order in which they're
	 * loaded, not an explicit cost.
	 */
	var bemgr = new insBackendInterface(this);
	var plugin, funcs;
	var ins = this;

	this.ins_bemgr = bemgr;
	this.ins_log.info('loading modules.');

	funcs = this.ins_backends.map(function (be) {
		return (function (err, cb) {
			ins.ins_current_backend = be;

			try {
				plugin = require('../../cmd/cainst/modules/' +
				    be);
			} catch (ex) {
				ins.ins_log.warn('FAILED to load module ' +
				    '"%s": %r', be, ex);
				cb();
			}

			plugin.insinit(bemgr, ins.ins_log, function () {
				ins.ins_log.info('loaded module "%s".', be);
				cb();
			});
		});
	});

	caRunStages(funcs, null, function () {

		if (mod_ca.caIsEmpty(ins.ins_impls))
			throw (new Error('No metrics registered. ' +
			    'Bailing out.'));

		ins.ins_current_backend = '<unknown>';
		ins.ins_log.info('finished loading modules.');
		callback();
	});
};

caInstrService.prototype.emit = function (name, evt)
{
	this.ins_bemgr.emit(name, evt);
};

caInstrService.prototype.initFini = function ()
{
	this.ins_log.info('AMQP broker connected.');
	this.notifyConfig();

	if (!this.ins_iid)
		this.ins_iid = setInterval(this.tick.bind(this), 1000);

	if (this.ins_starter) {
		this.ins_starter();
		delete (this.ins_starter);
	}
};

caInstrService.prototype.notifyConfig = function ()
{
	this.ins_cap.sendNotifyInstOnline(mod_cap.ca_amqp_key_config,
	    this.serializeMetrics());
};

caInstrService.prototype.serializeMetrics = function ()
{
	return (mod_metric.caMetricHttpSerialize(this.ins_metrics_impl,
	    this.ins_metadata));
};

/*
 * Invoked once per second to gather and report data.
 */
caInstrService.prototype.tick = function ()
{
	var svc, when, whenms, evt;

	svc = this;
	whenms = new Date().getTime();
	when = Math.floor(whenms / 1000);

	/*
	 * We want to report at the same point within each second as precisely
	 * as possible, so we use setInterval() to schedule this callback.
	 * However, if we're stopped for some amount of time, we don't want to
	 * report data for the same second more than once.
	 */
	if (this.ins_last && this.ins_last == when)
		return;

	evt = { fields: { subsecond: whenms % 1000 } };

	Object.keys(this.ins_instns).forEach(function (id) {
		var instn = svc.ins_instns[id];
		var gwhenms, gevt;

		if (instn.is_impl.tick)
			instn.is_impl.tick();

		/*
		 * For granularity > 1, we only want to report data on the exact
		 * second that we're supposed to, so we just check that the
		 * granularity divides the current time.  It's possible that for
		 * whatever reason we fail to run at that second (perhaps
		 * because the system is handling higher priority work for that
		 * full second), in which case we'd miss reporting the data
		 * point.  That's why we cap granularity at some small number of
		 * seconds: so the impact of a single missed data point is
		 * small.
		 */
		if (when % instn.is_granularity !== 0)
			return;

		gwhenms = new Date().getTime();
		gevt = {
		    cabackend: instn.is_backend,
		    cainstnid: instn.is_fqid,
		    cametric: instn.is_module + '.' + instn.is_stat,
		    subsecond: gwhenms % 1000
		};

		instn.is_impl.value(function (value) {
			if (value === undefined)
				svc.ins_log.warn(
				    'undefined value from instn %s', id);

			svc.ins_cap.sendData(instn.is_inst_key, id, value,
			    whenms);
			gevt['latency'] = (new Date().getTime() - gwhenms) *
			    1000 * 1000;
			svc.emit('instr_backend_op', { fields: gevt });
		});
	});

	this.ins_last = when;
	evt['fields']['latency'] =
	    (new Date().getTime() - whenms) * 1000 * 1000;
	this.emit('instr_tick', evt);
};

/*
 * Handle AMQP "status" command.
 */
caInstrService.prototype.amqpStatus = function (msg)
{
	var sendmsg = {};
	var id, inst;

	sendmsg.s_component = 'instrumenter';
	sendmsg.s_instrumentations = [];

	for (id in this.ins_instns) {
		inst = this.ins_instns[id];
		sendmsg.s_instrumentations.push({
		    s_inst_id: id,
		    s_module: inst.is_module,
		    s_stat: inst.is_stat,
		    s_predicate: inst.is_predicate,
		    s_decomposition: inst.is_decomposition,
		    s_since: inst.is_since
		});
	}

	sendmsg.s_metadata = this.serializeMetrics();
	sendmsg.s_modules = [];
	sendmsg.s_status = {
		instrumentations: sendmsg.s_instrumentations,
		amqp_cap: this.ins_cap.info(),
		uptime: new Date().getTime() - this.ins_start
	};

	for (id in this.ins_status_callbacks)
		sendmsg.s_status[id] = this.ins_status_callbacks[id]();

	this.ins_cap.sendCmdAckStatus(msg.ca_source, msg.ca_id, sendmsg);
};

caInstrService.prototype.implSupportsFields = function (impl, fields)
{
	var ii;

	for (ii = 0; ii < fields.length; ii++) {
		if (!caArrayContains(impl['fields'], fields[ii]))
			return (false);
	}

	return (true);
};

/*
 * Handle AMQP "enable_instrumentation" command.
 */
caInstrService.prototype.amqpEnableInstn = function (msg)
{
	var svc = this;
	var destkey = msg.ca_source;
	var id, basemetric, impl, impls, inst, ii, granularity, field;

	if (!('is_inst_id' in msg) || !('is_module' in msg) ||
	    !('is_stat' in msg) || !('is_predicate' in msg) ||
	    !('is_decomposition' in msg) || !('is_inst_key' in msg)) {
		this.ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'missing field', id, msg.is_inst_id);
		return;
	}

	id = msg.is_inst_id;

	/*
	 * This command is idempotent so if we're currently instrumenting this
	 * instrumentation then we're already done.
	 */
	if (id in this.ins_instns) {
		/* XXX check that it matches */
		this.ins_cap.sendCmdAckEnableInstSuc(destkey, msg.ca_id, id);
		return;
	}

	basemetric = this.ins_metrics_impl.baseMetric(msg.is_module,
	    msg.is_stat);
	if (!basemetric) {
		this.ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'unknown module or stat', id);
		return;
	}

	impls = this.ins_impls[msg.is_module][msg.is_stat];

	/*
	 * Search for the first sufficient backend for this instrumentation.
	 * These will have been declared in a deliberate order.  For example, so
	 * that "kstat" is searched before "dtrace".
	 */
	for (ii = 0; ii < impls.length; ii++) {
		if (this.implSupportsFields(impls[ii], msg.is_decomposition) &&
		    this.implSupportsFields(impls[ii],
		    mod_capred.caPredFields(msg.is_predicate)))
			break;
	}

	if (ii == impls.length) {
		this.ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'unsupported decomposition or predicate', id);
		return;
	}

	impl = impls[ii];

	granularity = 'is_granularity' in msg ? msg.is_granularity : 1;
	if (typeof (granularity) != typeof (0) ||
	    Math.floor(granularity) != granularity ||
	    granularity < 1) {
		this.ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'unsupported value for "is_granularity"', id);
		return;
	}

	/*
	 * We never want to accumulate more than N seconds worth of state
	 * inside the instrumenter itself, so we cap the granularity at N
	 * seconds so that we report data at least that often even if the
	 * aggregator will only be aggregating up.  We require that
	 * granularities greater than this be evenly divided by this so that the
	 * aggregator can easily aggregate these values over time.
	 */
	if (granularity > this.ins_granularity_max) {
		if (granularity % this.ins_granularity_max != 0) {
			this.ins_cap.sendCmdAckEnableInstFail(destkey,
			    msg.ca_id, 'granularity must be a multiple of ' +
			    this.ins_granularity_max, id);
			return;
		}

		granularity = this.ins_granularity_max;
	}

	inst = {};
	inst.is_fqid = id;
	inst.is_granularity = granularity;
	inst.is_module = msg.is_module;
	inst.is_stat = msg.is_stat;
	inst.is_predicate = mod_ca.caDeepCopy(msg.is_predicate);

	/*
	 * We copy the decompositions manually to ensure that numeric fields
	 * appear last, which simplifies the implementation of several backends.
	 * This implementation may reorder the discrete decompositions, but we
	 * only support one right now anyway.
	 */
	inst.is_decomposition = [];
	for (ii = 0; ii < msg.is_decomposition.length; ii++) {
		field = msg.is_decomposition[ii];

		if (this.ins_metadata.fieldArity(field) ==
		    mod_ca.ca_field_arity_discrete)
			inst.is_decomposition.unshift(field);
		else
			inst.is_decomposition.push(field);
	}

	if (msg.is_zones)
		inst.is_zones = mod_ca.caDeepCopy(msg.is_zones);

	inst.is_backend = impl.backend;
	inst.is_impl = impl.impl(mod_ca.caDeepCopy(inst));
	inst.is_inst_key = msg.is_inst_key;
	inst.is_since = new Date();

	this.ins_instns[id] = inst;

	inst.is_impl.instrument(function (err) {
		if (err) {
			delete (svc.ins_instns[id]);
			svc.ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
			    'instrumenter error: ' + err, id);
			return;
		}

		svc.ins_cap.sendCmdAckEnableInstSuc(destkey, msg.ca_id, id);
		svc.ins_log.info('instrumented %s (%s.%s)', id,
		    inst.is_module, inst.is_stat);
		svc.emit('instr_backend_enable', { fields: {
		    cabackend: inst.is_backend,
		    cainstnid: inst.is_fqid,
		    cametric: inst.is_module + '.' + inst.is_stat,
		    latency: (new Date().getTime() - inst.is_since.getTime()) *
			1000 * 1000
		} });
	});
};

/*
 * Handle AMQP "disable_instrumentation" command.
 */
caInstrService.prototype.amqpDisableInstn = function (msg)
{
	var svc = this;
	var destkey = msg.ca_source;
	var inst, start, id;

	if (!('is_inst_id' in msg)) {
		svc.ins_cap.sendCmdAckDisableInstFail(destkey, msg.ca_id,
		    'missing field');
		return;
	}

	id = msg.is_inst_id;

	if (!(id in svc.ins_instns)) {
		svc.ins_cap.sendCmdAckDisableInstSuc(destkey, msg.ca_id, id);
		return;
	}

	inst = svc.ins_instns[id];
	start = new Date().getTime();

	inst.is_impl.deinstrument(function (err) {
		if (err) {
			svc.ins_cap.sendCmdAckDisableInstFail(destkey,
			    msg.ca_id, 'instrumenter error: ' + err, id);
			return;
		}

		svc.ins_cap.sendCmdAckDisableInstSuc(destkey, msg.ca_id, id);
		delete (svc.ins_instns[id]);
		svc.ins_log.info('deinstrumented %s', id);
		svc.emit('instr_backend_disable', { fields: {
		    cabackend: inst.is_backend,
		    cainstnid: inst.is_fqid,
		    cametric: inst.is_module + '.' + inst.is_stat,
		    latency: (new Date().getTime() - start) * 1000 * 1000
		} });
	});
};

/*
 * Handle AMQP "config_reset" notification, which indicates that all active
 * instrumentations should be dropped.
 */
caInstrService.prototype.amqpCfgReset = function ()
{
	var svc, id;

	this.ins_log.info('config reset');

	if (mod_ca.caIsEmpty(this.ins_instns))
		return;

	svc = this;
	for (id in this.ins_instns) {
		this.ins_instns[id].is_impl.deinstrument(function () {
			delete (svc.ins_instns[id]);
		});
	}
};

/*
 * Handle AMQP "configsvc_online" message by replying with our own status.
 */
caInstrService.prototype.amqpCfgOnline = function ()
{
	this.ins_log.info('config service restarted');
	this.notifyConfig();
};

/*
 * Encapsulates the backend plugin interface.  This object is passed to each
 * plugin's insinit() function.  The plugin uses the methods of this object to
 * register its facilities with the Instrumenter.
 */
function insBackendInterface(svc)
{
	mod_events.EventEmitter.call(this);
	this.ibi_svc = svc;
}

mod_sys.inherits(insBackendInterface, mod_events.EventEmitter);

insBackendInterface.prototype.metadata = function ()
{
	return (this.ibi_svc.ins_metadata);
};

/*
 * Register a new metric.  Metrics describe ways of instrumenting the system.
 * The implementation must specify an object implementing the insMetric
 * interface.  'args' specifies the following fields:
 *
 *	module, stat	Strings defining the metric's name using a two-level
 *			namespace (module name, then stat name).  This namespace
 *			is provided for users' convenience and may have nothing
 *			to do with the name of the backend plugin.  Backends can
 *			define metrics in multiple modules.  In fact, backends
 *			can define metrics with the same module and stat names
 *			as those defined by other modules.  This is useful when
 *			the different backends have different costs of
 *			instrumentation and different capabilities with respect
 *			to predicates and decomposition.  When users attempt to
 *			instrument a metric with multiple implementations, the
 *			Instrumenter uses the one that supports all desired
 *			breakdowns and decompositions that has the lowest cost.
 *
 *	fields		Array of supported field names based on which data can
 *			be filtered or decomposed.
 *
 *	impl		Function that returns a new instance of a class meeting
 *			the insMetric interface.
 *
 * The module, stat, and all of the field names must be contained within the
 * global set of available metrics (defined in metadata).
 *
 * The insMetric interface is used to implement individual metrics.  When a new
 * instrumentation is created based on this metric, a new instance of this class
 * is created using the function specified by 'metric' above.  (Note that this
 * function *returns* an instance -- it is not the constructor itself.)  The
 * sole argument to this constructor function is a description of the
 * instrumentation including 'inst_id' (instrumentation id, for identification
 * purposes only), 'module', 'stat', 'predicate', and 'decomposition' fields.
 * The object must implement the following methods:
 *
 *	instrument(callback):	Instrument the system to collect the specified
 *				metric.  Invoke the specified callback when
 *				instrumentation is complete.
 *
 *	deinstrument(callback):	Deinstrument the system to stop collecting the
 *				specified metric.  Invoke the specified callback
 *				when deinstrumentation is complete.
 *
 *	value(callback):	Retrieve the current value of the metric.  The
 *				callback should be invoked with a value
 *				describing the events since the last value was
 *				reported.  This method will be invoked at a
 *				frequency determined by the granularity of the
 *				instrumentation.  If granularity is 1 second,
 *				this method will be invoked once per second.  If
 *				granularity is 60 seconds, this will only be
 *				invoked once per minute.
 *
 *	tick():			If specified, tick() is invoked once per
 *	[optional]		second.  This is useful for backends that must
 *				consume data once per second, even when the
 *				granularity is less frequent than that.
 */
insBackendInterface.prototype.registerMetric = function (args)
{
	var svc, module, stat, fields, func;
	var basemetric, impl, seenfields, field, ii;

	svc = this.ibi_svc;
	module = mod_ca.caFieldExists(args, 'module', '');
	stat = mod_ca.caFieldExists(args, 'stat', '');
	fields = mod_ca.caFieldExists(args, 'fields', []);
	func = mod_ca.caFieldExists(args, 'impl');

	basemetric = svc.ins_metrics_global.baseMetric(module, stat);
	if (!basemetric)
		throw (new Error(caSprintf('attempted to register metric ' +
		    'implementation for non-existent module "%s" stat "%s"',
		    module, stat)));

	svc.ins_metrics_impl.addMetric(module, stat, fields);

	if (!(module in svc.ins_impls))
		svc.ins_impls[module] = {};

	if (!(stat in svc.ins_impls[module]))
		svc.ins_impls[module][stat] = [];

	/*
	 * XXX it should be illegal (and we should check for this here) to
	 * define fields not already defined for this metric without also
	 * defining all existing fields for this metric.  That is, you can't
	 * define an implementation of a stat that's more flexible than an
	 * existing implementation in some ways and less flexible in others.
	 * Multiple implementations must be strictly more powerful (but of
	 * course may be more expensive).  This allows us to expose the
	 * abstraction of a single metric with multiple fields and then we just
	 * pick which the cheapest implementation that's flexible enough to do
	 * what we need, rather than having to expose multiple implementations
	 * to the config svc.
	 */
	impl = {};
	impl['impl'] = func;
	impl['fields'] = [];
	impl['backend'] = svc.ins_current_backend;
	seenfields = {};

	for (ii = 0; ii < fields.length; ii++) {
		field = fields[ii];

		if (!basemetric.containsField(field))
			throw (new Error(caSprintf('attempted to register ' +
			    'metric with invalid field: module "%s" stat ' +
			    '"%s" field "%s"', module, stat, field)));

		if (field in seenfields)
			throw (new Error(caSprintf('attempted to register ' +
			    'duplicate field "%s" in module "%s" stat "%s"',
			    field, module, stat)));

		impl['fields'].push(field);
		seenfields[field] = true;
	}

	svc.ins_impls[module][stat].push(impl);
	svc.ins_log.info('module "%s" registered %s.%s', impl['backend'],
	    module, stat);
};

/*
 * Registers a new status reporter.  The "reporter" function is invoked to
 * retrieve status information for debugging and monitoring.
 */
insBackendInterface.prototype.registerReporter = function (name, reporter)
{
	var svc = this.ibi_svc;
	mod_assert.ok(!(name in svc.ins_status_callbacks));
	svc.ins_status_callbacks[name] = reporter;
};

insBackendInterface.prototype.applyPredicate = mod_instr.caInstrApplyPredicate;

insBackendInterface.prototype.computeValue = function (bucketizers, decomps,
    datapts)
{
	var svc = this.ibi_svc;
	return (mod_instr.caInstrComputeValue(svc.ins_metadata, bucketizers,
	    decomps, datapts));
};

exports.caInstrService = caInstrService;
