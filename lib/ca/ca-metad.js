/*
 * ca-metad: Provides an implementation for transforming a JSON representation
 * of a D script into an actual D script to use.
 *
 * We export two functions:
 * mdGenerateDScript -- Generates a D script from a metric and Meta-D expression
 * mdValidateMetaD -- Validates a Meta-D expression
 */

var mod_ca = require('./ca-common.js');
var mod_capred = require('./ca-pred.js');
var mod_cadutil = require('./ca-dutil.js');
var ASSERT = require('assert').ok;

var md_pragma_maxzones = 4;

/*
 * A list of valid keys that we are allowed to see in a probedesc. We use a hash
 * for faster lookup than iterating over an array.
 */
var mdProbedescKeys = {
	probes: true,
	gather: true,
	alwaysgather: true,
	local: true,
	aggregate: true,
	transforms: true,
	predicate: true,
	clean: true,
	verify: true
};

/*
 * Verify that the store value we've been given makes sense. A store declaration
 * has two parts, whether it is global or not, and whether it is an associative
 * array or not. Currently only thread and global are allowed types for storage.
 *
 *	st		The string that describes how to store a value.
 *
 * Returns an object that describes the storage. It will always have the field
 * 'type' and optionally the field 'array'.
 *
 *	type		Describes whether a thread local or global variable was
 *			requested.
 *
 *	array		The string that describes how to index into the array.
 *			If not present, the user just wants a thread local
 *			array.
 */
function mdVerifyStore(st)
{
	var type, array, begind, endind;

	if (st == 'thread')
		return ({ type: st });

	if (st == 'global')
		return ({ type: st });

	/* We have an array declaration, let's break those up */
	begind = st.indexOf('[');
	endind = st.lastIndexOf(']');
	ASSERT(begind > 0, 'missing array declaration: \'[\'');
	ASSERT(endind > 0, 'misisng array declaration: \']\'');
	ASSERT(begind < endind, '\']\' comes before \'[\'');
	type = st.substring(0, begind);
	array = st.substring(begind, endind + 1);
	ASSERT(type == 'thread' || type == 'global', 'invalid storage type');

	return ({ type: type, array: array });
}

/*
 * Validates that a given gather expression is valid.
 *
 * 	gather		The object represented by either the 'gather' or
 * 			'alwaysgather' object.
 *
 * 	fields		An object that describes all the valid fields.
 */
function mdCheckGather(gather, fields)
{
	var key, ent, ii;

	for (key in gather) {
		ent = gather[key];
		ASSERT(key in fields, 'asked to ' +
		    'gather something that is not a field');
		ASSERT('gather' in ent);
		ASSERT('store' in ent);
		ASSERT(typeof (ent['gather']) == typeof (ent['store']),
		    'gather and store must be of the same type');
		if (Array.isArray(ent['gather'])) {
			ASSERT(ent['gather'].length == ent['store'].length,
			    'gather and store must be arrays of the same ' +
			    'length');
			for (ii = 0; ii < ent['gather'].length; ii++) {
				ASSERT(typeof (ent['gather'][ii]) ==
				    typeof (''), 'gather entries must be ' +
				    'strings');
				ASSERT(typeof (ent['store'][ii]) ==
				    typeof (''), 'gather entries must be ' +
				    'strings');
			}
			mdVerifyStore(ent['store'][ii]);
		} else if (typeof (ent['gather']) != typeof ('')) {
			ASSERT(false, 'gather and store fields must be ' +
			    'strings or arrays');
			mdVerifyStore(ent['store']);
		}
	}
}

/*
 * Generates the D expression for a single gather entry. The naming scheme
 * used is based on the field name and a numeric identifier to differentiate the
 * potentially many entries that it contains.
 *
 * 	st		The raw store structure
 *
 * 	name		The name to use for this variable
 *
 * 	num		The number corresponding to this entry
 */
function mdGenerateSingleGather(st, name, num)
{
	var pname, script, info, arr;

	ASSERT(typeof (st['store']) == typeof (''));

	info = mdVerifyStore(st['store']);

	if (info['array'])
		arr = info['array'];
	else
		arr = '';

	if (info['type'] == 'thread')
		pname = caSprintf('self->%s%d', name, num);
	else
		pname = caSprintf('%s%d', name, num);

	script = caSprintf('\t%s%s = %s;\n', pname, arr, st['gather']);

	return ({ name: pname, script: script });
}

/*
 * Generates the script snippet necessary for gather declarations.
 *
 * 	st		The object that describes the gather / store conditions.
 *
 * 	name		The base of the name to give the various statements that
 * 			we need to generate.
 */
function mdGenerateGather(st, name)
{
	var ent, ii;
	var ret = {};

	if (typeof (st['store']) == typeof ('')) {
		ent = mdGenerateSingleGather(st, name, 0);
		ret['script'] = ent['script'];
		ret['names'] = [ ent['name'] ];
	} else {
		ent = [];
		for (ii = 0; ii < st['store'].length; ii++)
			ent.push(mdGenerateSingleGather({
			    gather: st['gather'][ii],
			    store: st['store'][ii]
			}, name, ii));

		ret['names'] = ent.map(function (n) { return (n['name']); });
		ret['script'] = ent.reduce(function (cur, pri) {
		    return (pri + cur['script']);
		}, '');
	}

	return (ret);
}

/*
 * Validate that a given description of an object makes sense and contains the
 * correct fields for a Meta-D description.
 *
 * 	desc		An object representing the description of a metric.
 */
function mdValidateMetaD(desc)
{
	var probedesc, ii, jj, elt, key, ent, ks, locals, allfields;

	ASSERT(desc, 'missing argument metad');
	ASSERT(typeof (desc) == typeof ({}), 'metad must be an object');
	ASSERT('metad' in desc, 'desc object missing \'metad\'');
	ASSERT('fields' in desc, 'desc object missing \'fields\'');
	ASSERT('module' in desc, 'desc object missing \'module\'');
	ASSERT('stat' in desc, 'desc object missing \'stat\'');

	ASSERT(typeof (desc['metad']) == typeof ({}), 'desc.metad' +
	    'must be an object');
	ASSERT(typeof (desc['fields']) == typeof ([]), 'desc.fields ' +
	    'must be an array');
	ASSERT(Array.isArray(desc['fields']), 'desc.fields must be an array');
	ASSERT(typeof (desc['module']) == typeof (''), 'desc.module ' +
	    'must be a string');
	ASSERT(typeof (desc['stat']) == typeof (''), 'desc.stat' +
	    'must be a string');

	if (!desc['fields_internal'])
		desc['fields_internal'] = [];

	ASSERT(typeof (desc['fields_internal']) == typeof ([]),
	    'desc.fields_internal must be an array');
	ASSERT(Array.isArray(desc['fields_internal']),
	    'desc.fields_internal must be an array');

	/*
	 * Construct a set of all fields for reference, including internal
	 * fields.
	 */
	allfields = {};

	for (ii = 0; ii < desc['fields'].length; ii++)
		allfields[desc['fields'][ii]] = true;

	for (ii = 0; ii < desc['fields_internal'].length; ii++)
		allfields[desc['fields_internal'][ii]] = true;

	/* Go through and validate that the probedesc makes sense */
	ASSERT('probedesc' in desc['metad'],
	    'desc.metad missing \'probedesc\'');
	probedesc = desc['metad']['probedesc'];
	ASSERT(Array.isArray(probedesc),
	    'probedesc should be an array');
	ASSERT(probedesc.length >= 1,
	    'probedesc must have at least one element');

	locals = {};
	/* Figure out the local definitions situation */
	if ('locals' in desc['metad']) {
		ent = desc['metad']['locals'];
		ASSERT(Array.isArray(ent),
		    'locals must be an array');
		for (ii = 0; ii < ent.length; ii++) {
			elt = ent[ii];
			ASSERT(typeof (elt) == typeof ({}),
			    'locals must be an array of objects');
			key = Object.keys(elt);
			ASSERT(key.length == 1,
			    'objects in locals must only have one key');
			key = key[0];
			ASSERT(!(key in locals), 'cannot reuse key in local');
			ASSERT(typeof (elt[key]) == typeof (''),
			    'type value must be a string');
			locals[key] = elt[key];
		}
	}

	/*
	 * Here we are enforcing the following rules for each entry in the
	 * probedesc:
	 *
	 * - probes is always present
	 * - probes is an array of strings
	 * - probes is at least length 1
	 * - If a gather is specified, each key is a valid field
	 * - Each entry in the gather has all the necessary properties
	 * - We repeat the same with alwaysgather
	 * - The store string makes sense
	 * - if local is specified, it is an array of at least length 1
	 * - each entry in local contains is an object with a single key and a
	 *   string value
	 * - If aggregate is specified, it is an object,
	 * - If aggregate is specified, it has a default aggregation
	 * - If aggregate is specified, each key is in the list of fields and
	 *   none are marked internal
	 * - If aggregate is an object, transforms is specified and there is one
	 *   entry per each entry in aggregate, each value is a string
	 * - If verify is specified, it is an object and a corresponding
	 *   aggregate is present
	 * - If clean is specified, it is an object that is non-empty
	 * - If predicate is specified, it is a string with a D expression
	 */
	for (ii = 0; ii < probedesc.length; ii++) {
		elt = probedesc[ii];
		ks = {};
		for (key in elt) {
			ASSERT(key in mdProbedescKeys,
			    'invalid key in probedesc:' + key);
			if (key in ks)
				ASSERT(false, 'key already seen: ' + key);
			ks[key] = true;
		}
		ASSERT('probes' in ks, 'missing required probes argument');
		ASSERT(Array.isArray(elt['probes']),
		    'probes must be an array');
		for (jj = 0; jj < elt['probes'].length; jj++)
			ASSERT(typeof (elt['probes'][jj]) == typeof (''),
			    'probes must be a string array: ' +
			    elt['probes'][ii]);

		if ('gather' in ks)
			mdCheckGather(elt['gather'], allfields);

		if ('alwaysgather' in ks)
			mdCheckGather(elt['alwaysgather'], allfields);

		if ('local' in ks) {
			ASSERT(Array.isArray(elt['local']),
			    'local definition must be an array');
			for (jj = 0; jj < elt['local'].length; jj++) {
				ent = elt['local'][jj];
				ASSERT(typeof (ent) == typeof ({}),
				    caSprintf('local should be an array of ' +
				    'objects: %j', ent));
				key = Object.keys(ent);
				ASSERT(key.length == 1,
				    'each entry in local array should be an ' +
				    'object with one key');
				key = key[0];
				ASSERT(typeof (ent[key]) == typeof (''),
				    'local entry value should be a string');
				ASSERT(key in locals, 'cannot use local ' +
				    'value without specifying it in locals');
			}
		}

		if ('aggregate' in ks) {
			ASSERT(typeof (elt['aggregate']) == typeof ({}),
			    'aggregate field must be an object');
			ASSERT('transforms' in elt,
			    'must have transforms with aggregate');
			ASSERT(typeof (elt['transforms']) == typeof ({}),
			    'transforms field must be an object');
			ASSERT('default' in elt['aggregate'],
			    'aggregation needs a default value');

			for (key in elt['aggregate']) {
				if (key == 'default')
					continue;

				ASSERT(key in allfields,
				    'aggregate key is not a valid field: ' +
				    key);
				ASSERT(!caArrayContains(desc['fields_internal'],
				    key), 'cannot aggregate an internal field');
				ASSERT(key in elt['transforms'],
				    'aggregate key must be in transforms');
				ASSERT(typeof (elt['aggregate'][key]) ==
				    typeof (''),
				    'aggregate values must be strings');
				ASSERT(typeof (elt['transforms'][key]) ==
				    typeof (''),
				    'transform values must be strings');
			}
		}

		if ('transforms' in ks)
			ASSERT('aggregate' in ks, 'cannot have transforms' +
			    'without aggregate');

		if ('verify' in ks) {
			ASSERT(typeof (elt['verify']) == typeof ({}),
			    'verify field must be an object');
			ASSERT('aggregate' in ks, 'cannot have verify ' +
			    'without aggregate');
		}

		if ('clean' in ks) {
			ASSERT(typeof (elt['clean']) == typeof ({}),
			    'clean object must be an object');
			ASSERT(!caIsEmpty(elt['clean']),
			    'clean object cannot be empty');
		}

		if ('predicate' in ks)
			ASSERT(typeof (elt['predicate']) == typeof (''),
			    'predicate must always be a string');
	}

	/*
	 * Validate the following global properties:
	 *
	 * - There is at least one aggregate
	 * - Each non-internal field is taken care of in an aggregate statement
	 * - If clean is specified, we have previously declared a gather.
	 * - If we aggregate any gathered values, we have a verify for all of
	 *   them
	 * - All gathered values are cleaned once
	 */
	ks = {};
	ks['agg-keys'] = {};
	ks['gather-keys'] = {};
	ks['clean-keys'] = {};
	for (ii = 0; ii < probedesc.length; ii++) {
		if ('gather' in probedesc[ii]) {
			ks['gather'] = true;
			for (key in probedesc[ii]['gather'])
				ks['gather-keys'][key] = true;
		}

		if ('alwaysgather' in probedesc[ii]) {
			ks['gather'] = true;
			for (key in probedesc[ii]['alwaysgather'])
				ks['gather-keys'][key] = true;
		}

		if ('aggregate' in probedesc[ii]) {
			ks['aggregate'] = true;
			for (key in probedesc[ii]['aggregate'])
				ks['agg-keys'][key] = true;
		}

		if ('verify' in probedesc[ii]) {
			ks['verify'] = true;
			for (key in probedesc[ii]['verify'])
				ASSERT(key in ks['gather-keys'],
				    'verify must have all gathered keys ' +
				    'missing: ' + key);
		}

		if ('clean' in probedesc[ii]) {
			ks['clean'] = true;
			ASSERT('gather' in ks, 'cannot clean without a' +
			    'gather');
			for (key in probedesc[ii]['clean']) {
				ASSERT(key in ks['gather-keys'],
				    'cannot clean a variable that was never ' +
				    'gathered: ' + key);
				ks['clean-keys'][key] = true;
			}
		}
	}

	if ('gather' in ks) {
		ASSERT('clean' in ks, 'cannot gather without a clean');
		ASSERT('verify' in ks, 'cannot gather without a verify');
	}

	if ('clean' in ks) {
		ent = mod_ca.caDeepCopy(ks['gather-keys']);
		for (key in ks['clean-keys']) {
			ASSERT(key in ent, 'key set to clean without ' +
			    'gather: ' + key);
			delete (ent[key]);
		}
		ASSERT(mod_ca.caIsEmpty(ent), mod_ca.caSprintf('some keys ' +
		    'gathered but never cleaned: %j', ent));
	}

	ASSERT(ks['aggregate'], 'must specify at least one aggregate');
	for (key in allfields) {
		if (caArrayContains(desc['fields_internal'], key))
			continue;
		ASSERT(key in ks['agg-keys'], 'no aggregation for key ' + key);
	}
}

/*
 * Given an object that represents the metric with metad expression and the
 * requested instrumentation, sanity check that basic expected properties hold.
 *
 *	desc		An object representation that includes all of the
 *			module, stat, fields, and Meta-D description.
 *
 *	metric		An object that contains the information necessary to
 *			create the instrumentation. It specifies decompositions,
 *			predicates, and other options.
 */
function mdSanityCheck(desc, metric)
{
	/* Assert Basic properties of the metric */
	ASSERT(metric, 'missing argument metric');
	ASSERT(typeof (metric) == typeof ({}), 'metric must be an object');
	ASSERT('is_module' in metric, 'metric object missing \'is_module\'');
	ASSERT('is_stat' in metric, 'metric object missing \'is_stat\'');
	ASSERT('is_predicate' in metric, 'metric object missing ' +
	    '\'is_predicate\'');
	ASSERT('is_decomposition' in metric, 'metric object missing ' +
	    '\'is_decomposition\'');

	ASSERT(typeof (metric['is_module']) == typeof (''), 'metric.is_module' +
	    'must be a string');
	ASSERT(typeof (metric['is_stat']) == typeof (''), 'metric.is_stat' +
	    'must be a string');
	ASSERT(typeof (metric['is_predicate']) == typeof ({}), 'metric.' +
	    'is_predicate must be an object');
	ASSERT(Array.isArray(metric['is_decomposition']), 'metric.' +
	    'is_decomposition must be an array');
	ASSERT(metric['is_decomposition'].length <= 2,
	    'too many decompositions');

	/* Sanity check the desc object */
	mdValidateMetaD(desc);

	/* Verify we're talking about the same thing */
	ASSERT(metric['is_module'] == desc['module'], 'module mismatch');
	ASSERT(metric['is_stat'] == desc['stat'], 'stat mismatch');
}

/*
 * We don't always need to build a probe. We only need to do so if a field that
 * we have requested in the predicate or decomposition is used in here. This
 * function makes that determination as well as it can.
 *
 * 	probe		A single entry of the Meta-D probe description
 *
 * 	fields		An object with keys that indicate we care about a
 * 			specific field
 *
 * 	gather		An object with keys that describe which values we have
 * 			already gathered.
 *
 * Returns true if this probe description is necessary and false if not.
 */
function mdNeedProbe(probe, fields, gather)
{
	var key;

	if ('aggregate' in probe)
		return (true);

	if ('clean' in probe) {
		for (key in gather) {
			if (key in probe['clean'])
				return (true);
		}
	}

	if ('alwaysgather' in probe)
		return (true);

	for (key in probe['gather']) {
		if (key in fields)
			return (true);
	}

	return (false);
}

/*
 * Generate the valid D expression for the zone pragma.
 *
 *	zone		The name of the zone.
 */
function mdGeneratePragma(zone)
{
	return (mod_cadutil.dUtilGeneratePragma('zone', zone));
}

/*
 * Generates an expression for use in a predicate that handle assigning
 * values and ensuring that they are propagated. We always do (expr || 1)
 * because the value of the assignment can be zero and we want this to succeed.
 *
 *	local		An array of objects with one key that points to a string
 *			value. Each entry describes an assignment. i.e. { key:
 *			'timestamp' } would become the D expression 'this->key =
 *			timestamp'
 *
 */
function mdGenerateLocalVars(local)
{
	var key;
	return mod_cadutil.dUtilAndPredArray(local.map(function (obj) {
		for (key in obj)
			break;
		return (caSprintf('((this->%s = %s) != NULL || 1)', key,
		    obj[key]));
	}));
}

/*
 * Generates a D predicate expression for an array of predicates. Each predicate
 * is joined via &&.
 *
 * 	pred		An array of strings representing predicates
 */
function mdGeneratePredicate(pred)
{
	if (pred.length === 0)
		return ('');

	return (mod_cadutil.dUtilGeneratePredicate(pred));
}

/*
 * Transform strings can refer to stored values that are gathered. These are
 * referenced via $(\d+), i.e. $0. The number refers to the index of the
 * gathered data. If only one datum was gathered, it is always $0, otherwise it
 * corresponds to its array index.
 *
 * 	trans		The string to replace any references in
 *
 * 	names		An array of strings that contains the valid replacements
 */
function mdTransformsResolveEntry(trans, names)
{
	var re, ii, entries, d;

	entries = trans.match(/\$\d+/g);

	if (entries === null)
		return (trans);

	ASSERT(names !== null || names !== undefined);
	for (ii = 0; ii < entries.length; ii++) {
		re = new RegExp('\\' + entries[ii]);
		d = parseInt(entries[ii].substring(1), 10);
		trans = trans.replace(re, names[d]);
	}

	return (trans);
}

/*
 * We want to do something slightly different when transforming values in
 * predicates. The process, is similar but it is now required to specify a name
 * as well.
 */
function mdTransformsResolvePredicate(trans, names)
{
	var entries, d, re, ii, key;

	entries = trans.match(/\$[a-zA-Z-_]+\d+/g);

	if (entries === null)
		return (trans);

	for (ii = 0; ii < entries.length; ii++) {
		re = new RegExp('\\' + entries[ii]);
		key = entries[ii].match(/[a-zA-Z-_]+/g)[0];
		d = entries[ii].match(/\d+/g)[0];
		ASSERT(key in names,
		    'given field with no transformation: ' + key);
		trans = trans.replace(re, names[key]['names'][d]);
	}

	return (trans);
}

/*
 * Given an object that has strings to resolve to gathered values, make a copy
 * and resolve the keys in each entry.
 *
 * 	trans		An object with string vaules
 *
 * 	gather		An object that has an array of names that correspond to
 * 			keys in trans
 */
function mdTransformsResolve(trans, gather)
{
	var key, names;

	trans = caDeepCopy(trans);
	for (key in gather) {
		if (!(key in trans))
			continue;

		names = gather[key]['names'];
		trans[key] = mdTransformsResolveEntry(trans[key], names);
	}

	for (key in trans)
		trans[key] = '(' + trans[key] + ')';

	return (trans);
}

/*
 * A $0 can be specified in aggregations which corresponds to the
 * transformation. Resolve its transformation.
 *
 * 	agg		An object with keys for the aggregation
 *
 * 	trans		An object with keys that have the same names as agg
 * 			and whose values are strings.
 */
function mdAggregateResolve(agg, trans)
{
	var key, names;

	agg = caDeepCopy(agg);
	for (key in trans) {
		names = [ trans[key] ];
		agg[key] = mdTransformsResolveEntry(agg[key], names);
	}

	return (agg);
}

/*
 * Generate the series of implicit predicates that come about because we have
 * values that we have gathered and want to make sure that we include.
 *
 * 	gather		An object whose keys correspond to objects that we have
 * 			gathered and describes how to access it.
 */
function mdGenerateAggPreds(gather)
{
	if (!Array.isArray(gather))
		gather = [ gather ];

	return (mod_cadutil.dUtilAndPredArray(gather.map(function (n) {
	    return (caSprintf('(%s != NULL)', n));
	})));
}

/*
 * Generate the aggregation according to the following rules:
 *
 * 1) If no decompositions are present, use the default aggregation.
 * 2) All discrete decompositions are used to create the index for the
 * aggregation.
 * 3) If there are no numeric decompositions, use the aggregation for the
 * discrete decomposition.
 * 4) If a numeric decomposition is present, use its aggregation.
 *
 * 	decomps		A mapping of field keys to arities.
 *
 * 	agg		A mapping of field keys to strings of valid D that
 * 			describe how to aggregate the value.
 *
 *	trans		A mapping of field keys that describes how to get their
 *			values in D.
 *
 * Returns an object with the following information:
 *
 * 	script		The D language that describes this aggregation
 *
 *	zero		The Javascript value that describes zero for this object
 *
 * 	hasdists	A boolean that describes whether the aggregated	values
 * 			have distributions or not
 *
 * 	hasdecomps	A boolean that describes whether or not the aggregation
 * 			indexes on any decompositions
 */
function mdGenerateAggregate(decomps, agg, trans)
{
	var agginst, key, zero, hasdists, hasdecomps;
	var index = [];

	zero = 0;
	hasdists = false;
	hasdecomps = false;

	for (key in decomps) {
		if (decomps[key] == mod_ca.ca_field_arity_numeric) {
			agginst = mdTransformsResolveEntry(agg[key]);
			if (zero === 0)
				zero = [];
			hasdists = true;
		}

		if (decomps[key] == mod_ca.ca_field_arity_discrete) {
			index.push(trans[key]);
			zero = {};
			hasdecomps = true;
			if (!agginst)
				agginst = agg[key];
		}
	}

	if (!agginst)
		agginst = agg['default'];

	index = index.join(',');
	if (index != '')
		index = caSprintf('[%s]', index);

	return ({
	    script: mod_cadutil.dUtilGenerateAggregate(index, agginst),
	    zero: zero,
	    hasdists: hasdists,
	    hasdecomps: hasdecomps
	});
}

/*
 * Generate a statement to clean up all the D variables that are present, i.e.
 * null them all out.
 *
 * 	st		The store object with an entry for the array of names
 * 			to clean.
 */
function mdGenerateClean(st)
{
	if (!Array.isArray(st))
		st = [ st ];
	return (st.map(function (x) {
	    return (mod_cadutil.dUtilZeroVariable(x));
	}).join(''));
}

/*
 * Generate the series of statements that are needed for local variables.
 */
function mdGenerateLocalTypes(locals)
{
	var key, ii;
	var ret = '';

	for (ii = 0; ii < locals.length; ii++) {
		key = Object.keys(locals[ii])[0];
		ret += caSprintf('this %s %s;\n', locals[ii][key], key);
	}

	ret += '\n';

	return (ret);
}

/*
 * Transform a metric's arguments and its description into a D string.
 *
 *	desc		The full metric description, including stat, module,
 *			fields, and metad.
 *
 *	metric		The information from the about the specifics regarding
 *			this instrumentation.
 *
 *	metadata	Metric metadata
 *
 * Returns an object with the following fields:
 *
 * 	scripts		An array of scripts to run. Generally there will only be
 * 			one, but if we're using the #pragma D zone=%z, then we
 * 			may have more.
 *
 * 	zero		The value for zero for this metric.
 *
 *	hasdecomps	A boolean that tells whether or not there are any
 *			decompositions in the aggregation.
 *
 *	hasdists	A boolean that describes whether or not the value will
 *			have distributions.
 */
function mdGenerateDScript(desc, metric, metadata)
{
	var decomps, pragmazone, preds, fields, tmp, zonepred, ii, pent, lpred;
	var key, ret, ltrans, laggs, lclean, zero, hasdists, hasdecomps, lverif;
	var gathered = {};
	var script = '';

	mdSanityCheck(desc, metric);

	fields = {};
	decomps = {};
	pragmazone = false;
	zonepred = '';

	if (metric.is_zones) {
		/*
		 * If the number of zones to be instrumented is small, we use
		 * the DTrace zone pragma to instrument only the specified
		 * zones.  However, this requires a DTrace enabling (and its
		 * associated DRAM) per zone, so if the number is not so small
		 * we just use a single enabling to instrument everything.
		 */
		if (desc['metad']['usepragmazone'] &&
		    metric.is_zones.length < md_pragma_maxzones)
			pragmazone = true;

		zonepred = mod_cadutil.dUtilOrPredArray(
		    metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		    }));
	}

	/*
	 * We want to build the canonical list of fields we may need to gather.
	 */
	for (ii = 0; ii < metric['is_decomposition'].length; ii++) {
		tmp = metric['is_decomposition'][ii];
		decomps[tmp] = metadata.fieldArity(tmp);
		fields[tmp] = true;
	}

	if (mod_capred.caPredNonTrivial(metric.is_predicate)) {
		tmp = mod_capred.caPredFields(metric.is_predicate);
		for (ii = 0; ii < tmp.length; ii++)
			fields[tmp[ii]] = true;
	}

	/* Generate the local declarations */
	if (desc['metad']['locals'])
		script += mdGenerateLocalTypes(desc['metad']['locals']);

	/* Now we need to iterate each probe and do some work */
	for (ii = 0; ii < desc['metad']['probedesc'].length; ii++) {
		pent = desc['metad']['probedesc'][ii];

		if (!mdNeedProbe(pent, fields, gathered))
			continue;

		preds = [];
		script += pent['probes'].join(',\n') + '\n';

		/*
		 * We need to make sure we do our gathers, but not add the D for
		 * it so we have access to it for generating the predicates,
		 * etc.
		 */

		if ('alwaysgather' in pent) {
			for (key in pent['alwaysgather']) {
				gathered[key] =
				    mdGenerateGather(pent['alwaysgather'][key],
					key);
			}
		}

		if ('gather' in pent) {
			for (key in pent['gather']) {
				if (!(key in fields))
					continue;

				gathered[key] =
				    mdGenerateGather(pent['gather'][key], key);
			}
		}


		if ('aggregate' in pent) {
			ltrans =
			    mdTransformsResolve(pent['transforms'], gathered);
			lverif =
			    mdTransformsResolve(pent['verify'], gathered);
			laggs =
			    mdAggregateResolve(pent['aggregate'], ltrans);
			for (key in gathered) {
				preds.push(mdGenerateAggPreds(lverif[key]));
			}
		}

		if ('aggregate' in pent && zonepred != '')
			preds.push(zonepred);

		if ('local' in pent)
			preds.push(mdGenerateLocalVars(pent['local']));

		if ('predicate' in pent)
			preds.push(mdTransformsResolvePredicate(
			    pent['predicate'], gathered));

		if ('aggregate' in pent &&
		    mod_capred.caPredNonTrivial(metric.is_predicate)) {
			lpred = mod_ca.caDeepCopy(metric.is_predicate);
			mod_capred.caPredReplaceFields(ltrans,
			    lpred);
			preds.push(mod_capred.caPredPrint(lpred));
		}

		script += mdGeneratePredicate(preds);
		script += '{\n';

		if ('alwaysgather' in pent) {
			for (key in pent['alwaysgather'])
				script += gathered[key]['script'];
		}

		if ('gather' in pent) {
			for (key in pent['gather']) {
				if (!(key in fields))
					continue;

				script += gathered[key]['script'];
			}
		}

		if ('aggregate' in pent) {
			key = mdGenerateAggregate(decomps,
			    laggs, ltrans);
			script += key['script'];
			zero = key['zero'];
			hasdists = key['hasdists'];
			hasdecomps = key['hasdecomps'];
		}

		/*
		 * Not every clean statement necessarily has something for every
		 * gather. However, we do know that all of them will be touched
		 * at least once. Thus we don't want to do every key that's been
		 * gathered, just those that we have in this clean clause.
		 */
		if ('clean' in pent) {
			lclean =
			    mdTransformsResolve(pent['clean'], gathered);
			for (key in gathered) {
				if (key in lclean)
					script += mdGenerateClean(lclean[key]);
			}
		}

		script += '}\n\n';
	}

	if (pragmazone && metric.is_zones) {
		ret = metric.is_zones.map(function (zone) {
		    return (caSprintf('%s\n\n%s', mdGeneratePragma(zone),
		        script));
		});
	} else {
		ret = [ script ];
	}

	return ({
	    scripts: ret,
	    zero: zero,
	    hasdists: hasdists,
	    hasdecomps: hasdecomps
	});
}

exports.mdValidateMetaD = mdValidateMetaD;
exports.mdGenerateDScript = mdGenerateDScript;
