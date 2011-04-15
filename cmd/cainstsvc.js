/*
 * cainstsvc: Cloud Analytics Instrumenter service
 */

var ASSERT = require('assert').ok;

var mod_ca = require('../lib/ca/ca-common');
var mod_cap = require('../lib/ca/ca-amqp-cap');
var mod_dbg = require('../lib/ca/ca-dbg');
var mod_log = require('../lib/ca/ca-log');
var mod_capred = require('../lib/ca/ca-pred');
var mod_md = require('../lib/ca/ca-metadata');
var mod_metric = require('../lib/ca/ca-metric');

var ins_name = 'instsvc';	/* component name */
var ins_vers = '0.0';		/* component version */

var ins_iid;			/* interval timer id */
var ins_insts = {};		/* active instrumentations by id */
var ins_impls = {};		/* metric implementations */
var ins_status_callbacks = {};	/* callbacks for getting status info */

var ins_metadata_raw;		/* metric metadata (JSON) */
var ins_metadata;		/* metric metadata (object) */
var ins_metrics_global;		/* MetricSet for all defined metrics */
var ins_metrics_impl;		/* MetricSet for implemented metrics */
var ins_cap;			/* cap wrapper */
var ins_log;			/* log handle */
var ins_amqp;

function main()
{
	var sysinfo = mod_ca.caSysinfo(ins_name, ins_vers);
	var mdmgr, dbg_log, queue;

	mod_dbg.caEnablePanicOnCrash();
	caDbg.set('sysinfo', sysinfo);

	caDbg.set('ins_name', ins_name);
	caDbg.set('ins_vers', ins_vers);
	caDbg.set('ins_insts', ins_insts);
	caDbg.set('ins_impls', ins_impls);
	caDbg.set('ins_status_callbacks', ins_status_callbacks);

	ins_log = new mod_log.caLog({ out: process.stderr });
	caDbg.set('ins_log', ins_log);

	if (process.argv.length > 2) {
		dbg_log = mod_log.caLogFromFile(process.argv[2],
		    { candrop: true }, mod_log.caLogError(ins_log));
		ins_log.info('Logging AMQP debug messages to "%s"',
		    process.argv[2]);
		caDbg.set('amqp_dbg_log', dbg_log);
	}

	queue = mod_cap.ca_amqp_key_base_instrumenter + sysinfo.ca_hostname;

	ins_cap = new mod_cap.capAmqpCap({
	    dbglog: dbg_log,
	    log: ins_log,
	    queue: queue,
	    sysinfo: sysinfo
	});

	caDbg.set('ins_cap', ins_cap);
	ins_cap.bind(mod_cap.ca_amqp_key_all);
	ins_cap.on('msg-cmd-status', insCmdStatus);
	ins_cap.on('msg-cmd-enable_instrumentation', insCmdEnable);
	ins_cap.on('msg-cmd-disable_instrumentation', insCmdDisable);
	ins_cap.on('msg-notify-configsvc_online', insNotifyConfigRestarted);
	ins_cap.on('msg-notify-config_reset', insNotifyConfigReset);

	ins_log.info('Instrumenter starting up (%s/%s)', ins_name, ins_vers);
	ins_log.info('%-12s %s', 'Hostname:', sysinfo.ca_hostname);
	ins_log.info('%-12s %s', 'AMQP broker:',
	    JSON.stringify(ins_cap.broker()));
	ins_log.info('%-12s %s', 'Routing key:', queue);

	mdmgr = new mod_md.caMetadataManager(ins_log, './metadata');
	mdmgr.load(function (err) {
		if (err)
			caPanic('failed to load metadata', err);

		ins_metadata_raw = mdmgr.get('metric', 'metrics');
		ins_metadata = new mod_metric.caMetricMetadata();
		caDbg.set('ins_metadata', ins_metadata);
		ins_metadata.addFromHost(ins_metadata_raw, 'metrics.json');

		ins_metrics_global = ins_metadata.metricSet();
		caDbg.set('ins_metrics_global', ins_metrics_global);

		ins_metrics_impl = new mod_metric.caMetricSet();
		caDbg.set('ins_metrics_impl', ins_metrics_impl);

		insInitBackends();
		ins_cap.on('connected', insStarted);
		ins_cap.start();
	});
}

/*
 * Encapsulates the backend plugin interface.  This object is passed to each
 * plugin's insinit() function.  The plugin uses the methods of this object to
 * register its facilities with the Instrumenter.
 */
function insBackendInterface() {}

insBackendInterface.prototype.metadata = function ()
{
	return (ins_metadata);
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
 *	value():		Retrieve the current value of the metric.
 */
insBackendInterface.prototype.registerMetric = function (args)
{
	var module, stat, fields, func;
	var basemetric, impl, seenfields, field, ii;

	module = mod_ca.caFieldExists(args, 'module', '');
	stat = mod_ca.caFieldExists(args, 'stat', '');
	fields = mod_ca.caFieldExists(args, 'fields', []);
	func = mod_ca.caFieldExists(args, 'impl');

	basemetric = ins_metrics_global.baseMetric(module, stat);
	if (!basemetric)
		throw (new Error(caSprintf('attempted to register metric ' +
		    'implementation for non-existent module "%s" stat "%s"',
		    module, stat)));

	ins_metrics_impl.addMetric(module, stat, fields);

	if (!(module in ins_impls))
		ins_impls[module] = {};

	if (!(stat in ins_impls[module]))
		ins_impls[module][stat] = [];

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

	ins_impls[module][stat].push(impl);
};

/*
 * Registers a new status reporter.  The "reporter" function is invoked to
 * retrieve status information for debugging and monitoring.
 */
insBackendInterface.prototype.registerReporter = function (name, reporter)
{
	ASSERT(!(name in ins_status_callbacks));
	ins_status_callbacks[name] = reporter;
};

/*
 * Search for installed Instrumenter backend plugins and load them.  We
 * currently hardcode this list, but ideally we'd find everything in some
 * particular directory.
 */
function insInitBackends()
{
	/*
	 * Preference between different backends (determined by how expensive
	 * they are to use) is implicitly defined by the order in which they're
	 * loaded, not an explicit cost.
	 */
	var backends = [ 'kstat', 'dtrace' ];
	var bemgr = new insBackendInterface();
	var plugin, ii;

	ins_log.info('Loading modules.');

	for (ii = 0; ii < backends.length; ii++) {
		try {
			plugin = require('./cainst/modules/' + backends[ii]);
		} catch (ex) {
			ins_log.warn('FAILED to load module "%s": %r',
			    backends[ii], ex);
		}

		plugin.insinit(bemgr, ins_log);
		ins_log.info('Loaded module "%s".', backends[ii]);
	}

	if (mod_ca.caIsEmpty(ins_impls))
		throw (new Error('No metrics registered.  Bailing out.'));

	ins_log.info('Finished loading modules.');
}

function insGetModules()
{
	return (mod_metric.caMetricHttpSerialize(ins_metrics_impl,
	    ins_metadata));
}

function insNotifyConfig()
{
	var metadata = insGetModules();
	ins_cap.sendNotifyInstOnline(mod_cap.ca_amqp_key_config, metadata);
}

function insStarted()
{
	ins_log.info('AMQP broker connected.');
	insNotifyConfig();

	if (!ins_iid)
		ins_iid = setInterval(insTick, 1000);
}

/*
 * Invoked once/second to gather and report data.
 */
var ins_last;

function insTick()
{
	var id, when, value;

	when = new Date().getTime();

	/*
	 * If for some reason we get invoked multiple times within the same
	 * second, we ignore the subsequent invocations to avoid confusing the
	 * aggregator.
	 */
	if (ins_last &&
	    Math.floor(when / 1000) == Math.floor(ins_last / 1000))
		return;

	for (id in ins_insts) {
		value = ins_insts[id].is_impl.value();
		if (value === undefined)
			ins_log.warn('undefined value from inst %s', id);
		ins_cap.sendData(ins_insts[id].is_inst_key, id, value, when);
	}

	ins_last = when;
}

/*
 * Process AMQP status command.
 */
function insCmdStatus(msg)
{
	var sendmsg = {};
	var id, inst;

	sendmsg.s_component = 'instrumenter';
	sendmsg.s_instrumentations = [];

	for (id in ins_insts) {
		inst = ins_insts[id];
		sendmsg.s_instrumentations.push({
		    s_inst_id: id,
		    s_module: inst.is_module,
		    s_stat: inst.is_stat,
		    s_predicate: inst.is_predicate,
		    s_decomposition: inst.is_decomposition,
		    s_since: inst.is_since
		});
	}

	sendmsg.s_metadata = insGetModules();
	sendmsg.s_modules = [];
	sendmsg.s_status = {
		instrumentations: sendmsg.s_instrumentations,
		amqp_cap: ins_cap.info()
	};

	for (id in ins_status_callbacks)
		sendmsg.s_status[id] = ins_status_callbacks[id]();

	ins_cap.sendCmdAckStatus(msg.ca_source, msg.ca_id, sendmsg);
}

/*
 * Given an array of fields, return true if the specified metric implementation
 * supports all of the fields.
 */
function insImplSupportsFields(impl, fields)
{
	var ii;

	for (ii = 0; ii < fields.length; ii++) {
		if (!caArrayContains(impl['fields'], fields[ii]))
			return (false);
	}

	return (true);
}

/*
 * Process AMQP command to enable an instrumentation.
 */
function insCmdEnable(msg)
{
	var destkey = msg.ca_source;
	var id, basemetric, impl, impls, inst, ii;

	if (!('is_inst_id' in msg) || !('is_module' in msg) ||
	    !('is_stat' in msg) || !('is_predicate' in msg) ||
	    !('is_decomposition' in msg) || !('is_inst_key' in msg)) {
		ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'missing field', id, msg.is_inst_id);
		return;
	}

	id = msg.is_inst_id;

	/*
	 * This command is idempotent so if we're currently instrumenting this
	 * instrumentation then we're already done.
	 */
	if (id in ins_insts) {
		/* XXX check that it matches */
		ins_cap.sendCmdAckEnableInstSuc(destkey, msg.ca_id, id);
		return;
	}

	basemetric = ins_metrics_impl.baseMetric(msg.is_module, msg.is_stat);
	if (!basemetric) {
		ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'unknown module or stat', id);
		return;
	}

	impls = ins_impls[msg.is_module][msg.is_stat];

	for (ii = 0; ii < impls.length; ii++) {
		if (insImplSupportsFields(impls[ii], msg.is_decomposition) &&
		    insImplSupportsFields(impls[ii],
		    mod_capred.caPredFields(msg.is_predicate)))
			break;
	}

	if (ii == impls.length) {
		ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'unsupported decomposition or predicate', id);
		return;
	}

	impl = impls[ii];

	inst = {};
	inst.is_module = msg.is_module;
	inst.is_stat = msg.is_stat;
	inst.is_predicate = mod_ca.caDeepCopy(msg.is_predicate);
	inst.is_decomposition = mod_ca.caDeepCopy(msg.is_decomposition);
	if (msg.is_zones)
		inst.is_zones = mod_ca.caDeepCopy(msg.is_zones);
	inst.is_impl = impl.impl(mod_ca.caDeepCopy(inst));
	inst.is_inst_key = msg.is_inst_key;
	inst.is_since = new Date();

	ins_insts[id] = inst;
	inst.is_impl.instrument(function (err) {
		if (err) {
			delete (ins_insts[id]);
			ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
			    'instrumenter error: ' + err, id);
			return;
		}

		ins_cap.sendCmdAckEnableInstSuc(destkey, msg.ca_id, id);
		ins_log.info('instrumented %s (%s.%s)', id,
		    inst.is_module, inst.is_stat);
	});
}

/*
 * Process AMQP command to disable an instrumentation.
 */
function insCmdDisable(msg)
{
	var destkey = msg.ca_source;
	var id;

	if (!('is_inst_id' in msg)) {
		ins_cap.sendCmdAckDisableInstFail(destkey, msg.ca_id,
		    'missing field');
		return;
	}

	id = msg.is_inst_id;

	if (!(id in ins_insts)) {
		ins_cap.sendCmdAckDisableInstSuc(destkey, msg.ca_id, id);
		return;
	}

	ins_insts[id].is_impl.deinstrument(function (err) {
		if (err) {
			ins_cap.sendCmdAckDisableInstFail(destkey, msg.ca_id,
			    'instrumenter error: ' + err, id);
			return;
		}

		ins_cap.sendCmdAckDisableInstSuc(destkey, msg.ca_id, id);
		delete (ins_insts[id]);
		ins_log.info('deinstrumented %s', id);
	});
}

/*
 * Invoked when the configuration service restarts.  Because instrumentations
 * are not yet persistent, we drop all the data we have and start again.
 */
function insNotifyConfigReset()
{
	var id;

	ins_log.info('config reset');

	if (mod_ca.caIsEmpty(ins_insts))
		return;

	for (id in ins_insts) {
		ins_insts[id].is_impl.deinstrument(function (err) {
		    delete (ins_insts[id]);
		});
	}
}

function insNotifyConfigRestarted()
{
	ins_log.info('config service restarted');
	insNotifyConfig();
}

main();
