/*
 * ca-inst.js: Instrumentation management, used primarily by the configuration
 *     service, and related functions
 */

var mod_ca = require('./ca-common');
var mod_caerr = require('./ca-error');
var mod_capred = require('./ca-pred');
var ASSERT = require('assert').ok;

var cai_agg_maxinsts = 50;		/* max # of insts per aggregator */
var cai_timeout_aggenable = 5 * 1000;	/* 5 seconds for aggregator */
var cai_timeout_instenable = 10 * 1000;	/* 10 seconds per instrumenter */
var cai_timeout_instdisable = 10 * 1000;

var cai_retain_min = 10;		/* min data retention time: 10 sec */
var cai_retain_max = 10 * 60 * 60;	/* max data retention time: 1 hour */
var cai_retain_default = 10 * 60;	/* default data retention: 10 min */

var cai_idle_max_min = 0;			/* never expire */
var cai_idle_max_max = 60 * 60 * 24 * 7;	/* 1 week */
var cai_idle_max_default = 60 * 60;		/* 1 hour */

var cai_http_uri_cust = '/customers';
var cai_http_uri_inst = '/instrumentations';
var cai_http_uri_raw  = '/value/raw';
var cai_http_uri_heatmap_image = '/value/heatmap/image';
var cai_http_uri_heatmap_details = '/value/heatmap/details';

/*
 * An instrumentation factory encapsulates the configuration and steps required
 * to create, modify, and delete an instrumentation.  This includes input
 * validation and communicating with both aggregators and instrumenters.
 * Ideally, the configuration service itself would be simply an HTTP wrapper
 * around this object.  Currently, the global state of instrumentations,
 * aggregators, and instrumenters is still maintained by the configuration
 * service, so this component assumes knowledge of the internal configuration
 * service data structures.  However, this component has *no* direct
 * communication with the user (i.e. no knowledge of HTTP) and this should stay
 * that way.  The caError framework provides enough abstraction that the
 * configuration service can easily convert our exceptions to user-facing error
 * messages.
 *
 * The "conf" argument must contain the following members:
 *
 *	cap		AMQP-CAP wrapper
 *
 *	log		log for debugging
 *
 *	metrics		list of available metrics (caMetricSet)
 *
 *	transformations	list of available transformations
 *
 *	aggregators	list of aggregator hostnames (default: none)
 *
 *	instrumenters	list of instrumenter hostnames (default: none)
 *
 *	uri_base	base for instrumentation URIs
 *
 * The "conf" argument may also contain the following members:
 *
 *	mapi		caMapi object for querying MAPI
 */
function caInstrumentationFactory(conf)
{
	var factory;

	ASSERT(conf.cap);
	this.cif_cap = conf.cap;
	ASSERT(conf.log);
	this.cif_log = conf.log;
	ASSERT(conf.metrics);
	this.cif_metrics = conf.metrics;
	ASSERT(conf.transformations);
	this.cif_transformations = conf.transformations;
	ASSERT(conf.aggregators);
	this.cif_aggregators = conf.aggregators;
	ASSERT(conf.instrumenters);
	this.cif_instrumenters = conf.instrumenters;
	ASSERT(conf.uri_base);
	this.cif_uri_base = conf.uri_base;

	this.cif_mapi = conf.mapi;
	this.cif_customers = {};
	this.cif_next_global_id = 1;

	factory = this;
	this.cif_stages_create = [
		this.stageValidate,
		this.stageCheckContainers,
		this.stageEnableAggregator,
		this.stageEnableInstrumenters,
		this.stageComplete
	].map(function (method) {
		return (mod_ca.caWrapMethod(factory, method));
	});
}

exports.caInstrumentationFactory = caInstrumentationFactory;

/*
 * Returns debugging and monitoring information.
 */
caInstrumentationFactory.prototype.info = function ()
{
	var ret = {};

	ret['cai_agg_maxinsts'] = cai_agg_maxinsts;
	ret['cai_timeout_aggenable'] = cai_timeout_aggenable;
	ret['cai_timeout_instenable'] = cai_timeout_instenable;
	ret['cai_timeout_instdisable'] = cai_timeout_instdisable;
	ret['cai_retain_min'] = cai_retain_min;
	ret['cai_retain_max'] = cai_retain_max;
	ret['cai_retain_default'] = cai_retain_default;
	ret['cai_idle_max_min'] = cai_idle_max_min;
	ret['cai_idle_max_max'] = cai_idle_max_max;
	ret['cai_idle_max_default'] = cai_idle_max_default;
	ret['next_global_id'] = this.cif_next_global_id;

	return (ret);
};

/*
 * Create a new instrumentation scoped to the given customer id and with the
 * given properties.  Upon successful completion, the callback will be invoked
 * with a null error object and a non-null "instrumentation" object -- an
 * instance of class caInstrumentation below.
 */
caInstrumentationFactory.prototype.create = function (custid, props, pset,
    callback)
{
	var request;

	request = {
	    cust_id: custid,
	    properties: props,
	    pset: pset,
	    callback: callback
	};

	caRunStages(this.cif_stages_create, request, callback);
	return (request);
};

/*
 * Deletes the given instrumentation.
 */
caInstrumentationFactory.prototype.destroy = function (inst, callback)
{
	var fqid, hostname, aggregator, instrumenter, nleft, errors, done;
	var log = this.cif_log;

	done = function () {
		var ii;

		if (errors.length === 0)
			return (callback());

		for (ii = 0; ii < errors.length; ii++)
			log.warn('failed to disable "%s" on host "%s": %s',
			    fqid, errors[ii].hostname, errors[ii].error);

		return (callback(new caError(ECA_REMOTE, errors[0],
		    'failed to disable %d instrumenters; saving first error',
		    errors.length)));
	};

	fqid = inst.fqid();
	log.dbg('deleting instrumentation %s', inst.fqid());
	aggregator = inst.aggregator();

	ASSERT(fqid in aggregator.cag_insts);
	delete (aggregator.cag_insts[fqid]);
	aggregator.cag_ninsts--;

	nleft = 1;
	errors = [];
	for (hostname in this.cif_instrumenters) {
		instrumenter = this.cif_instrumenters[hostname];

		if (fqid in instrumenter.ins_insts) {
			instrumenter.ins_ninsts--;
			delete (instrumenter.ins_insts[fqid]);
		}

		++nleft;
		this.disableInstrumenter(inst, instrumenter, function (err) {
			if (err)
				errors.push({ hostname: hostname, error: err });

			if (--nleft === 0)
				done();
		});
	}

	if (--nleft === 0)
		done();
};

/*
 * Re-enable aggregation for a particular instrumentation.  Aggregation is
 * initially enabled when the instrumentation is created, but must be explicitly
 * reenabled when the aggregator restarts or the instrumentation's properties
 * change.
 */
caInstrumentationFactory.prototype.reenableAggregator = function (inst,
    callback)
{
	var aggregator, instkey;

	ASSERT(inst instanceof caInstrumentation);
	aggregator = inst.aggregator();
	instkey = mod_ca.caRouteKeyForInst(inst.fqid());

	this.cif_cap.cmdEnableAgg(aggregator.cag_routekey, inst.fqid(),
	    instkey, inst.properties(), cai_timeout_aggenable, function () {
		if (callback)
			callback.apply(null, arguments);
	    });
};

/*
 * Enable data collection for a particular instrumentation on a particular host.
 * Instrumentation is initially enabled when the instrumentation is created and
 * must be explicitly reenabled when the instrumenter restarts.
 */
caInstrumentationFactory.prototype.enableInstrumenter = function (inst,
    instrumenter, callback)
{
	var fqid = inst.fqid();
	var instkey, zones;

	instkey = mod_ca.caRouteKeyForInst(fqid);
	zones = inst.zonesbyhost(instrumenter.ins_hostname);
	ASSERT(zones === undefined || zones.length > 0);

	this.cif_cap.cmdEnableInst(instrumenter.ins_routekey,
	    fqid, instkey, inst.properties(), zones, cai_timeout_instenable,
	    function (err, okay) {
		ASSERT(err || okay);
		if (callback)
			callback.apply(null, arguments);
	    });
};

/*
 * Disable data collection for an instrumentation on a particular host.
 */
caInstrumentationFactory.prototype.disableInstrumenter = function (inst,
    instrumenter, callback)
{
	var fqid = inst.fqid();

	ASSERT(!instrumenter.ins_insts[fqid]);

	this.cif_cap.cmdDisableInst(instrumenter.ins_routekey, fqid,
	    cai_timeout_instdisable, function (err, okay) {
		ASSERT(err || okay);
		if (callback)
			callback.apply(null, arguments);
	    });
};

/*
 * Update the properties for a particular instrumentation.  Attempts to change
 * immutable properties are ignored (just like attempts to change non-existent
 * properties).
 */
caInstrumentationFactory.prototype.setProperties = function (inst, props,
    callback)
{
	var mutables, ii, newprops = caDeepCopy(inst.properties());

	this.cif_log.dbg('setting new properties for "%s": %j',
	    inst.fqid(), props);

	try {
		mutables = caInstValidateMutableFields(props,
		    inst.custid() === undefined);
	} catch (ex) {
		return (callback(ex));
	}

	for (ii = 0; ii < mutables.length; ii++) {
		if (mutables[ii] in props)
			newprops[mutables[ii]] = props[mutables[ii]];
	}

	inst.loadProperties(newprops);
	return (this.reenableAggregator(inst, callback));
};

/*
 * [private] Create Stage: Validate instrumentation
 */
caInstrumentationFactory.prototype.stageValidate = function (request, callback)
{
	var props, metric, fields, fieldtypes, ii;

	props = request.properties;

	/*
	 * "module" and "stat" are always required.
	 */
	if (!props['module'])
		return (callback(new caInvalidFieldError('module')));

	if (!props['stat'])
		return (callback(new caInvalidFieldError('stat')));

	/*
	 * Check whether the base metric exists in the user's profile.  If not,
	 * we act just as though it didn't exist at all.
	 */
	metric = request.pset.baseMetric(props['module'], props['stat']);
	if (!metric)
		return (callback(new caInvalidFieldError('module.stat',
		    props['module'] + '.' + props['stat'],
		    'not a valid module/stat pair')));

	request.metric = metric;

	/*
	 * "decomposition" is optional.  If it comes in as a string, convert it
	 * to an empty array to match our canonical form.
	 */
	if (!props['decomposition'] || props['decomposition'] === '')
		props['decomposition'] = [];
	else if (typeof (props['decomposition']) == typeof (''))
		props['decomposition'] = props['decomposition'].split(',');

	/*
	 * "predicate" is also optional.  If it comes in as a string, it should
	 * be reparsed, since the canonical representation is always an object
	 * but clients may pass in a JSON (string) representation.
	 */
	if (!props['predicate'])
		props['predicate'] = {};
	else if (typeof (props['predicate']) == typeof ('')) {
		try {
			props['predicate'] = JSON.parse(props['predicate']);
		} catch (ex) {
			return (callback(new caInvalidFieldError('predicate',
			    props['predicate'], 'invalid JSON: ' +
			    ex.message)));
		}
	}

	/*
	 * Validate the predicate.  We do this before validating whether the
	 * decomposition and predicate use valid fields because the predicate
	 * must have correct form to even extract the fields from it.  However,
	 * caPredValidate will blow up if the user tries to use an unknown field
	 * in a predicate.
	 * XXX this should be fixed so that error messages are consistent.
	 */
	fieldtypes = metric.fieldTypes();
	try {
		mod_capred.caPredValidate(fieldtypes, props['predicate']);
	} catch (ex) {
		return (callback(new caError(ECA_INVAL, ex)));
	}

	/*
	 * Now that we've got a valid base metric and predicate struture, check
	 * that the user-specified fields are valid.
	 */
	request.fields = fields = props['decomposition'].concat(
	    mod_capred.caPredFields(props['predicate']));
	for (ii = 0; ii < fields.length; ii++) {
		if (!(fields[ii] in fieldtypes))
			return (callback(new caInvalidFieldError('field',
			    fields[ii], 'no such field for specified metric')));
	}

	/*
	 * Validate the decomposition fields and fill in the value-* members.
	 */
	try {
		request.arity = caInstArity(fieldtypes, props['decomposition']);
		props['value-dimension'] = request.arity['dimension'];
		props['value-arity'] = request.arity['arity'];
	} catch (ex) {
		return (callback(ex));
	}

	/*
	 * Fill in available transformations.
	 */
	props['transformations'] = caInstTransformations(fieldtypes,
	    this.cif_transformations, props);

	/*
	 * Validate the optional mutable fields.
	 */
	if (!('enabled' in props))
		props['enabled'] = 'true';
	if (!('retention-time' in props))
		props['retention-time'] = cai_retain_default;
	if (!('idle-max' in props))
		props['idle-max'] = cai_idle_max_default;

	try {
		caInstValidateMutableFields(props,
		    request.cust_id === undefined);
	} catch (ex) {
		return (callback(ex));
	}

	return (callback(null, request));
};

/*
 * [private] Create Stage: Check MAPI for containers
 */
caInstrumentationFactory.prototype.stageCheckContainers = function (request,
    callback)
{
	var custs, custid;

	custs = this.cif_customers;
	custid = request.cust_id;

	if (custid === undefined) {
		request.inst_id = this.cif_next_global_id++;
		callback(null, request);
		return;
	}

	if (!this.cif_mapi) {
		callback(new caError(ECA_REMOTE, null,
		    'MAPI is not configured'));
		return;
	}

	this.cif_mapi.listContainers(custid, function (err, zonesbyhost) {
		if (err)
			return (callback(new caError(ECA_REMOTE, err,
			    'failed to list customer zones for %s', custid)));

		if (!(custid in custs))
			custs[custid] = 1;

		request.zonesbyhost = zonesbyhost;
		request.inst_id = custs[custid]++;
		return (callback(null, request));
	});
};

/*
 * [private] Returns an available aggregator.  We currently choose a random
 * available aggregator with the expectation that this will spread load around
 * and minimize the likelihood of becoming corked on a single bad aggregator.
 */
caInstrumentationFactory.prototype.pickAggregator = function ()
{
	var hostname, aggregator, rand;
	var aggregators = [];

	for (hostname in this.cif_aggregators) {
		aggregator = this.cif_aggregators[hostname];
		if (aggregator.cag_ninsts >= cai_agg_maxinsts)
			continue;

		aggregators.push(aggregator);
	}

	if (aggregators.length === 0)
		return (undefined);

	rand = Math.floor(Math.random() * aggregators.length);
	return (aggregators[rand]);
};

/*
 * [private] Create Stage: Choose and enable an aggregator.
 */
caInstrumentationFactory.prototype.stageEnableAggregator = function (request,
    callback)
{
	var aggregator, fqid;

	aggregator = this.pickAggregator();

	if (!aggregator)
		return (callback(new caError(ECA_NORESOURCE, null,
		    'no aggregators available')));

	request.inst = new caInstrumentation({
		aggregator: aggregator,
		cust_id: request.cust_id,
		inst_id: request.inst_id,
		properties: request.properties,
		uri_base: this.cif_uri_base,
		zonesbyhost: request.zonesbyhost
	});
	fqid = request.inst.fqid();
	this.cif_log.dbg('creating instrumentation %s on aggregator %s', fqid,
	    aggregator.cag_hostname);
	request.routekey = mod_ca.caRouteKeyForInst(fqid);

	this.cif_cap.cmdEnableAgg(aggregator.cag_routekey, fqid,
	    request.routekey, request.inst.properties(), cai_timeout_aggenable,
	    function (err, okay) {
		if (err) {
			/* XXX try another aggregator? */
			return (callback(new caError(ECA_NORESOURCE,
			    err, 'failed to enable aggregator')));
		}

		ASSERT(okay);
		aggregator.cag_insts[fqid] = true;
		aggregator.cag_ninsts++;
		return (callback(null, request));
	    });

	return (undefined);
};

/*
 * [private] Create Stage: Enable all instrumenters.
 */
caInstrumentationFactory.prototype.stageEnableInstrumenters = function (request,
    callback)
{
	var hostname, hosts, instrumenter, log;
	var nleft, nenabled, errors, done;
	var factory = this;

	log = this.cif_log;
	hosts = request.zonesbyhost || this.cif_instrumenters;
	nleft = 0;
	nenabled = 0;
	errors = [];

	done = function () {
		var ii;

		if (errors.length === 0)
			return (callback(null, request));

		for (ii = 0; ii < errors.length; ii++)
			log.warn('failed to enable "%s" on host "%s": %s',
			    request.inst.fqid(), errors[ii].hostname,
			    errors[ii].error);

		factory.destroy(request.inst, caNoop);
		return (callback(new caError(ECA_REMOTE,
		    errors[0].error, 'failed to enable %d instrumenters; ' +
		    'saving first error', errors.length)));
	};

	++nleft;

	for (hostname in hosts) {
		/*
		 * It's possible that we're looking at a compute node with
		 * customer zones whose instrumenter (if it even has one) has
		 * never reported its existence to us.  For now, we simply
		 * ignore all of the zones on such nodes.
		 */
		if (!(hostname in this.cif_instrumenters))
			continue;

		if (!(this.cif_metrics.supports(request.metric,
		    request.fields, hostname))) {
			this.cif_log.dbg('skipping instrumenter %s: doesn\'t ' +
			    'support this metric', hostname);
			continue;
		}

		instrumenter = this.cif_instrumenters[hostname];

		++nleft;
		++nenabled;
		this.enableInstrumenter(request.inst, instrumenter,
		    function (err) {
			var fqid = request.inst.fqid();

			if (err) {
				errors.push({ hostname: hostname, error: err });
			} else {
				instrumenter.ins_insts[fqid] = true;
				instrumenter.ins_ninsts++;
			}

			if (--nleft === 0)
				done();
		    });
	}

	if (--nleft === 0)
		done();

	ASSERT(nenabled > 0);
};

/*
 * [private] Create Stage: Finish creating the instrumentation.
 */
caInstrumentationFactory.prototype.stageComplete = function (request, callback)
{
	callback(null, request.inst);
};

/*
 * Representation of an instrumentation.  Each instrumentation has several
 * properties, most of them immutable, which are documented in the HTTP API
 * documentation.
 *
 * The constructor's "conf" argument must specify the following members:
 *
 *	properties	the properties for this instrumentation
 *
 *	cust_id		the customer id to which this instrumentation is scoped
 *
 *	inst_id		the instrumentation's identifier
 *
 *	aggregator	aggregator for this instrumentation
 *
 *	uri_base	base of instrumentation URIs
 *
 *	zonesbyhost	if specified, maps instrumenter hostnames to list of
 *			zones to instrument on that system
 */
function caInstrumentation(conf)
{
	this.ci_custid = conf.cust_id;
	ASSERT(conf.inst_id);
	this.ci_instid = conf.inst_id;
	this.ci_fqid = mod_ca.caQualifiedId(conf.cust_id, conf.inst_id);
	ASSERT(conf.uri_base);
	this.ci_uri_base = conf.uri_base;

	ASSERT(conf.aggregator);
	this.ci_aggregator = conf.aggregator;

	if (conf.zonesbyhost)
		this.ci_zonesbyhost = conf.zonesbyhost;

	ASSERT(conf.properties);
	this.loadProperties(conf.properties);
}

/*
 * [private] Load properties from the given object.
 */
caInstrumentation.prototype.loadProperties = function (props)
{
	var fields, ii, uris, uri;
	var custid, instid, baseuri;

	this.ci_props = {};

	fields = [ 'module', 'stat', 'predicate', 'decomposition',
	    'value-dimension', 'value-arity', 'enabled', 'retention-time',
	    'idle-max', 'transformations' ];

	for (ii = 0; ii < fields.length; ii++) {
		ASSERT(fields[ii] in props, fields[ii] + ' is present');
		this.ci_props[fields[ii]] = props[fields[ii]];
	}

	baseuri = this.ci_uri_base;
	custid = this.ci_custid;
	instid = this.ci_instid;
	uri = caSprintf('%s%s%s/%s', baseuri,
	    (custid ? cai_http_uri_cust + '/' + custid : ''),
	    cai_http_uri_inst, instid);
	this.ci_props['uri'] = uri;

	uris = [];
	if (this.ci_props['value-arity'] == mod_ca.ca_arity_numeric) {
		uris.push({
		    uri: uri + cai_http_uri_heatmap_image,
		    name: 'value_heatmap'
		});
		uris.push({
		    uri: uri + cai_http_uri_heatmap_details,
		    name: 'details_heatmap'
		});
	}

	uris.push({ uri: uri + cai_http_uri_raw, name: 'value_raw' });
	this.ci_props['uris'] = uris;
};

caInstrumentation.prototype.custid = function ()
{
	return (this.ci_custid);
};

caInstrumentation.prototype.properties = function ()
{
	return (this.ci_props);
};

caInstrumentation.prototype.fqid = function ()
{
	return (this.ci_fqid);
};

caInstrumentation.prototype.aggregator = function ()
{
	return (this.ci_aggregator);
};

caInstrumentation.prototype.zonesbyhost = function (host)
{
	if (!this.ci_zonesbyhost)
		return (undefined);

	if (!(host in this.ci_zonesbyhost))
		return ([]);

	return (this.ci_zonesbyhost[host]);
};

/*
 * Given a the field types for a metric and the 'decomposition' fields of a
 * potential instrumentation, validate the decomposition fields and return the
 * "arity" of one of the resulting data points.  This is specified as an object
 * with the following member:
 *
 *	dimension	Describes the dimensionality of each datum as an
 *			integer.  For simple scalar metrics, the dimension is 1.
 *			The dimensionality increases with each decomposition.
 *
 *	arity		Describes the datum itself.  If dimension is 1, then
 *			type is always 'scalar'.  If any decompositions use a
 *			numeric field (e.g., latency), then type is
 *			'numeric-decomposition'.  Otherwise, type is
 *			'discrete-decomposition'.
 *
 * Combined, this information allows clients to know whether to visualize the
 * result as a simple line graph, a line graph with multiple series, or a
 * heatmap.  For examples:
 *
 *	METRIC				DIM	type		VISUAL
 *	i/o ops				1	scalar		line
 *	i/o ops by disk			2	discrete 	multi-line
 *	i/o ops by latency		2	numeric		heatmap
 *	i/o ops by latency and disk	3	numeric		heatmap
 */
function caInstArity(fieldtypes, decomp)
{
	var field, type, ctype, ii;
	var ndiscrete = 0;
	var nnumeric = 0;

	type = decomp.length === 0 ? mod_ca.ca_arity_scalar :
	    mod_ca.ca_arity_discrete;

	for (ii = 0; ii < decomp.length; ii++) {
		field = decomp[ii];
		ASSERT(field in fieldtypes);

		ctype = mod_ca.caTypeToArity(fieldtypes[field]);
		if (ctype == mod_ca.ca_arity_numeric) {
			type = mod_ca.ca_arity_numeric;
			nnumeric++;
		} else {
			ndiscrete++;
		}
	}

	if (ndiscrete > 1)
		throw (new caInvalidFieldError('decomposition', decomp,
		    'more than one discrete decomposition specified'));

	if (nnumeric > 1)
		throw (new caInvalidFieldError('decomposition', decomp,
		    'more than one numeric decomposition specified'));

	return ({ dimension: decomp.length + 1, arity: type });
}

/*
 * Validates the mutable fields of an instrumentation.
 * XXX convert caHttpParam to use caInvalidFieldError and make this function
 * much simpler.
 */
function caInstValidateMutableFields(props, privileged)
{
	var retain, idle;

	if ('enabled' in props) {
		if (props['enabled'] !== 'true')
			throw (new caInvalidFieldError('enabled',
			    props['enabled'], 'unsupported value'));

		props['enabled'] = true;
	}

	if ('retention-time' in props) {
		retain = parseInt(props['retention-time'], 10);

		if (isNaN(retain))
			throw (new caInvalidFieldError('retention-time',
			    props['retention-time'], 'not a number'));

		if (retain < cai_retain_min)
			throw (new caInvalidFieldError('retention-time',
			    props['retention-time'], 'minimum is %s',
			    cai_retain_min));

		if (retain > cai_retain_max)
			throw (new caInvalidFieldError('retention-time',
			    props['retention-time'], 'maximum is %s',
			    cai_retain_max));

		props['retention-time'] = retain;
	}

	if ('idle-max' in props) {
		idle = parseInt(props['idle-max'], 10);

		if (isNaN(idle))
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'not a number'));

		if (idle < cai_idle_max_min)
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'minimum is %s',
			    cai_idle_max_min));

		if (idle > cai_idle_max_max)
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'maximum is %s',
			    cai_idle_max_max));

		if (idle === 0 && !privileged)
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'zero not allowed'));

		props['idle-max'] = idle;
	}

	return ([ 'enabled', 'retention-time', 'idle-max' ]);
}

/*
 * Fill in available transformations based on the specified metric and the
 * instrumentation defined by "props".
 */
function caInstTransformations(fieldtypes, transformations, props)
{
	var ret = {};
	var ii, tname, ttypes, ftype, transform;

	for (tname in transformations) {
		transform = transformations[tname];
		ttypes = transform['types'];
		for (ii = 0; ii < props['decomposition'].length; ii++) {
			ftype = fieldtypes[props['decomposition'][ii]];
			if (caArrayContains(ttypes, ftype) && !(tname in ret))
				ret[tname] = transform;
		}
	}

	return (ret);
}
