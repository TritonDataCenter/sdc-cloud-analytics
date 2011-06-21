/*
 * ca-metric.js: supporting facilities for managing metrics
 *
 *
 * METRICS OVERVIEW: BASE METRICS, FIELDS, AND INSTRUMENTATIONS
 *
 * Metrics are just quantities that can be instrumented.  A *base metric* is a
 * scalar quantity named by a (module name, stat name) tuple.  (The distinction
 * between module and stat exists solely for organizing the available metrics as
 * a namespace.  Metrics in the same module have no special relationship or
 * additional semantics, except that they're likely to be related as far as the
 * end user is concerned.)  The set of base metrics supported by the system is
 * essentially static and defined when the system starts up.  Each base metric's
 * configuration may also specify one or more *fields* denoting additional data
 * that can be used for predicating (filtering) and decomposition.  For example,
 * the base metric "disk I/O operations" denotes a scalar quantity which is the
 * total number of I/O operations, but it may provide a field called "disk" that
 * allows for examining the number of I/O operations for each disk
 * (decomposition) or for a particular disk (predicate).  When the user directs
 * CA to gather data by creating an *instrumentation*, they specify which base
 * metric they're interested in, a predicate, and zero or more decompositions.
 *
 *
 * SINGLE NAMESPACE
 *
 * There is a single namespace for base metrics (that is, module names and stat
 * names) and field names across a Cloud Analytics instance.  This is obvious
 * for base metrics, since we obviously want "disk.operations" to mean the same
 * thing on compute node X as it does on compute node Y.  This is also valuable
 * for fields so that "zonename" means the same thing no matter which base
 * metric is using it.
 *
 *
 * FACILITIES FOR WORKING WITH METRICS
 *
 * Many CA subsystems work with groups of metrics:
 *
 *	o instrumenters maintain a set of supported metrics, as well as the type
 *	  information for each field since metric implementations generally need
 *	  the type information to construct the value
 *
 *	o the configuration service knows about the union of all instrumenters'
 *	  sets of supported metrics so that it can validate new user
 *	  instrumentation requests and provide information about available
 *	  metrics to clients
 *
 *	o profiles exist to provide users with restricted privileges or roles
 *	  visibility into a subset of the available metrics
 *
 * To support these cases, this file defines several facilities for working with
 * groups of metrics:
 *
 *	caMetricSet		Represents a set of base metrics and associated
 *				fields for each one.  Sets can be enumerated,
 *				intersected with other sets, and queried for a
 *				potential module, stat, and field combination.
 *				Metric sets do not include any metadata (type
 *				and label information).
 *
 *	caMetricMetadata	Represents the metadata for a set of base
 *				metrics and associated fields.  This metadata
 *				includes human-readable labels, field types,
 *				units, and other display information.  Metadata
 *				can only be queried, but this object can provide
 *				a caMetricSet instance that describes the set of
 *				metrics described by the metadata.
 *
 * The rule of thumb is that to check validity, visibility, or access control
 * for a potential metric, or to enumerate the valid or visible metrics, one
 * should use a metric set.  The metadata object should be used when a given
 * metric or field are known to be valid and the metadata is needed.
 *
 *
 * METADATA
 *
 * Because metric names and field names are universal and essentially
 * predefined, the set of base metrics, fields and additional metadata (like
 * types and human-readable labels) are defined in static JSON metadata.  The
 * top-level object must define the following fields:
 *
 *	modules		associative array of "module" objects indexed by module
 *			name.  Each object has the following member:
 *
 *		label	human-readable label for this module
 *
 *	types		associative array of "type" objects indexed by type
 *			name.  Each object has the following member:
 *
 *		arity	"numeric" or "discrete".  The arity of a type determines
 *			what operations are valid for predicates and
 *			decompositions involving fields with this type.  For
 *			example, only numeric fields can use inequality
 *			operators in predicates.
 *
 *		The following members are optional and provide hints to clients,
 *		but may only be specified for types of arity "numeric":
 *
 *		unit		base label that should appear on the axis of a
 *				chart that graphs values having this type.  For
 *				example, type "size" may have unit "bytes",
 *				indicating that values of type "size" should be
 *				labeled with "bytes".  The label may be combined
 *				with SI prefixes like "nano", "milli", "mega",
 *				"giga", etc. if "value-base" is also present.
 *				If unspecified, no unit should be displayed at
 *				all, or the unit is specified elsewhere.
 *
 *		abbr		abbreviation for the unit (e.g., "B" for bytes)
 *
 *		minmax		the recommended minimum value for the top of a
 *				chart.  This is used for percentage types to
 *				indicate that the graph should always show up to
 *				100% rather than auto-scaling down.  If
 *				unspecified, charts should always auto-scale.
 *
 *		base		If specified, the displayed unit name should be
 *				prefixed with the SI prefixes whose base
 *				corresponds to the value of this property.  The
 *				only allowable values are 2 for base-2 prefixes
 *				(like K for Kilo, M for Mega, etc.) and 10 for
 *				base-10 prefixes (like Ki, Mi, etc.).  If
 *				unspecified, the displayed unit is unmodified.
 *				This member may only be specified if "unit" is
 *				also specified.
 *
 *		power		If specified, "unit" and "base" must also be
 *				specified.  "power" indicates the actual unit
 *				that numbers are reported in.  If unspecified
 *				and "value-base" is specified, the value is
 *				assumed to be "0" (indicating that the reporting
 *				unit is the same as the display unit).  See the
 *				example below.
 *
 *		An illustrative example using most of these fields is the "time"
 *		type, where the unit is "seconds" (since all SI prefixes are
 *		prepended to "seconds"), "value-base" is 10 to indicate that
 *		base-10 prefixes should be applied (otherwise you'd see
 *		something like "0.000000182 seconds" instead of "182
 *		nanoseconds"), and "value-power" is -9 to indicate that the
 *		reporting unit is 10^-9 seconds (nanoseconds) rather than
 *		just plain seconds.
 *
 *		A discrete type called "string" is automatically created and
 *		used for fields with no type specified (see below).
 *
 *	fields		associative array of "field" objects indexed by field
 *			name.  Each object must have the following member:
 *
 *		label		human-readable label for this field
 *
 *			Each object may have the following member:
 *
 *		type		specifies the type of the field.  If
 *				unspecified, a default discrete type is used.
 *
 *	metrics		array of "metric" objects, each with the following
 *			members:
 *
 *		module, stat	the module and stat name for this metric
 *
 *		label		human-readable label for this metric
 *
 *		fields:		array of field names that apply to this metric
 *
 *			Each object must have exactly one one of the following
 *			members:
 *
 *		unit		human-readable label for this quantity (e.g.,
 *				"packets")
 *
 *		type		type for this quantity
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('./ca-common');

/*
 * Encapsulates a set of metrics.  This can be used to represent a profile, or a
 * set of metrics implemented by an instrumenter, or a set of metrics supported
 * by the configuration service, etc.  Principally, consumers can use a metric
 * set to query whether a given potential metric is present (i.e. whether it is
 * valid) or to iterate all available metrics.  This object does *not* contain
 * any of the metric metadata like human-readable labels or types.  See
 * caMetricMetadata for that.
 */
function caMetricSet()
{
	/*
	 * We store the information in two ways:
	 *    cms_modules	All metrics indexed by module name.
	 *
	 *	Each module's value is an object for that module's stats indexed
	 *	by stat name.  Each stat's value is an array of strings denoting
	 *	valid field names for that stat.
	 *
	 *    cms_byhost	Supported metrics by host name, as follows:
	 *
	 *	host => supported module names =>
	 *	supported stat names => supported field names
	 */
	this.cms_modules = {};
	this.cms_byhost = {};
}

/*
 * Add the specified "metrics" and mark whether they're supported by the named
 * "host".  Any metrics previously marked supported by this host will be cleared
 * unless they're also specified in "metrics".  The form of "metrics" matches
 * that specified by the CA AMQP protocol's "instrumenter_online" message.
 */
caMetricSet.prototype.addFromHost = function (metrics, host)
{
	var metric, module, stat, field, byhost, ii, jj;

	byhost = {};

	for (ii = 0; ii < metrics.length; ii++) {
		metric = metrics[ii];
		module = metric['module'];
		stat = metric['stat'];

		if (!(module in this.cms_modules))
			this.cms_modules[module] = {};

		if (!(stat in this.cms_modules[module]))
			this.cms_modules[module][stat] = {};

		if (!(module in byhost))
			byhost[module] = {};

		if (!(stat in byhost[module]))
			byhost[module][stat] = {};

		for (jj = 0; jj < metric['fields'].length; jj++) {
			field = metric['fields'][jj];
			this.cms_modules[module][stat][field] = true;
			byhost[module][stat][field] = true;
		}
	}

	this.cms_byhost[host] = byhost;
};

/*
 * Add a metric from the form used by profile and metric metadata, which is an
 * object with just "module", "stat", and "fields".
 */
caMetricSet.prototype.addMetric = function (module, stat, fields)
{
	var ii, statfields;

	if (!(module in this.cms_modules))
		this.cms_modules[module] = {};

	if (!(stat in this.cms_modules[module]))
		this.cms_modules[module][stat] = {};

	statfields = this.cms_modules[module][stat];
	for (ii = 0; ii < fields.length; ii++)
		statfields[fields[ii]] = true;
};

/*
 * Returns a caMetric instance for the metric identified by the specified module
 * and stat, if such a metric exists in this set.  Returns null otherwise.
 */
caMetricSet.prototype.baseMetric = function (module, stat)
{
	if (!(module in this.cms_modules))
		return (null);

	if (!(stat in this.cms_modules[module]))
		return (null);

	return (new caMetric(module, stat, this.cms_modules[module][stat]));
};

/*
 * Returns an array of all base metrics in this metric set.
 */
caMetricSet.prototype.baseMetrics = function ()
{
	var module, stat, ret;

	ret = [];

	for (module in this.cms_modules) {
		for (stat in this.cms_modules[module])
			ret.push(this.baseMetric(module, stat));
	}

	return (ret);
};

/*
 * Returns whether the metric identified by the given base metric (an instance
 * of caMetric) and a set of fields is contained within this MetricSet and
 * supported by the named "host".  If no "host" is specified, then returns true
 * if any host supports the specified metrics.
 */
caMetricSet.prototype.supports = function (metric, fields, host)
{
	var source, ii, supfields, module, stat;

	module = metric.module();
	stat = metric.stat();

	if (host === undefined) {
		source = this.cms_modules;
	} else {
		if (!(host in this.cms_byhost))
			return (false);

		source = this.cms_byhost[host];
	}

	if (!(module in source) || !(stat in source[module]))
		return (false);

	supfields = source[module][stat];

	for (ii = 0; ii < fields.length; ii++) {
		if (!(fields[ii] in supfields))
			return (false);
	}

	return (true);
};

/*
 * Returns the intersection of this metric set with the specified other set.
 * The host information is *not* preserved in the new set.
 */
caMetricSet.prototype.intersection = function (rhs)
{
	var res = new caMetricSet();
	res.addPartialIntersection(this, rhs);
	res.addPartialIntersection(rhs, this);
	return (res);
};

/*
 * [internal] Adds the metrics from "lhs" that also exist in "rhs" to "this".
 */
caMetricSet.prototype.addPartialIntersection = function (lhs, rhs)
{
	var modname, statname, fieldname;
	var lstats, rstats, lfields, rfields;

	for (modname in lhs.cms_modules) {
		if (!(modname in rhs.cms_modules))
			continue;

		lstats = lhs.cms_modules[modname];
		rstats = rhs.cms_modules[modname];

		for (statname in lstats) {
			if (!(statname in rstats))
				continue;

			lfields = lstats[statname];
			rfields = rstats[statname];

			this.addMetric(modname, statname, []);

			for (fieldname in lfields) {
				if (!(fieldname in rfields))
					continue;

				this.addMetric(modname, statname,
				    [ fieldname ]);
			}
		}
	}
};

/*
 * Represents a single base metric.  This class is only exposed to the outside
 * world via the baseMetric() method of caMetricSet.
 */
function caMetric(module, stat, fields)
{
	this.cm_module = module;
	this.cm_stat = stat;
	this.cm_fields = caDeepCopy(fields);
}

caMetric.prototype.module = function () { return (this.cm_module); };
caMetric.prototype.stat = function () { return (this.cm_stat); };

caMetric.prototype.fields = function ()
{
	return (Object.keys(this.cm_fields));
};

caMetric.prototype.containsField = function (field)
{
	return (field in this.cm_fields);
};

/*
 * An instance of caMetricMetadata is used to load, validate and access metric
 * metadata.
 */
function caMetricMetadata()
{
	this.cmm_messages = [];
	this.cmm_nerrors = 0;
	this.cmm_nwarnings = 0;
	this.cmm_modules = {};
	this.cmm_fields = {};
	this.cmm_metrics = {};
	this.cmm_types = {};

	this.addType('built-in', { name: 'string', arity: 'discrete' });
}

/* [private] */
caMetricMetadata.prototype.checkText = function (label, value)
{
	if (!(/^\w+$/.test(value))) {
		this.warn('%s "%s" contains illegal characters', label, value);
		return (false);
	}

	return (true);
};

/* [private] */
caMetricMetadata.prototype.checkPresentType = function (label, obj, key,
    prototype, optional)
{
	if (!(key in obj)) {
		if (!optional)
			this.error('%s: missing required field "%s"',
			    label, key);
		return (false);
	}

	if (typeof (obj[key]) != typeof (prototype) ||
	    obj[key].constructor !== prototype.constructor) {
		this.error('%s, field "%s": expected %s', label, key,
		    prototype.constructor.name);
		return (false);
	}

	return (true);
};

/* [private] */
caMetricMetadata.prototype.warn = function ()
{
	var message = caSprintf.apply(null, arguments);
	this.write('warning', message);
	this.cmm_nwarnings++;
};

/* [private] */
caMetricMetadata.prototype.error = function ()
{
	var message = caSprintf.apply(null, arguments);
	this.write('error', message);
	this.cmm_nerrors++;
};

/* [private] */
caMetricMetadata.prototype.write = function (type, message)
{
	this.cmm_messages.push(
	    caSprintf('%s: %s: %s\n', this.cmm_name, type, message));
};

/*
 * Updates metadata based on information received from a remote host.  Throws an
 * ECA_INVAL exception if the new metadata conflicts with existing metadata.
 */
caMetricMetadata.prototype.addFromHost = function (metadata, host)
{
	var messages;

	ASSERT(this.cmm_nerrors === 0);
	ASSERT(this.cmm_nwarnings === 0);
	ASSERT(this.cmm_messages.length === 0);

	this.cmm_name = host;
	this.addGroup(metadata, 'types', this.addType);
	this.addGroup(metadata, 'fields', this.addField);
	this.addGroup(metadata, 'modules', this.addModule);
	this.addGroup(metadata, 'metrics', this.addMetric);
	this.cmm_name = undefined;

	ASSERT(this.cmm_nerrors + this.cmm_nwarnings ==
	    this.cmm_messages.length);

	if (this.cmm_messages.length > 0) {
		messages = this.cmm_messages;
		this.cmm_messages = [];
		this.cmm_nerrors = 0;
		this.cmm_nwarnings = 0;

		throw (new caError(ECA_INVAL, null,
		    '%d errors processing metadata:\n%s', messages.length,
		    messages.join('')));
	}
};

/* [private] */
caMetricMetadata.prototype.insert = function (label, collection, name, value)
{
	if (!(name in collection)) {
		collection[name] = value;
		return;
	}

	if (!caDeepEqual(collection[name], value))
		this.error('%s: conflict: have %j, got %j', label,
		    collection[name], value);
};

caMetricMetadata.prototype.addGroup = function (obj, key, func)
{
	var method, ii, nobj;

	if (!(key in obj)) {
		this.error('top-level: "%s" not specified', key);
		return;
	}

	if (!(obj[key] instanceof Object)) {
		this.error('top-level: "%s" must be an object or array', key);
		return;
	}

	method = func.bind(this);

	if (Array.isArray(obj[key])) {
		for (ii = 0; ii < obj[key].length; ii++) {
			nobj = caDeepCopy(obj[key][ii]);

			if (!(nobj instanceof Object)) {
				this.error('%s[%s] is not an object or array',
				    key, ii);
				continue;
			}

			method(caSprintf('%s[%s]', key, ii), nobj);
		}

		return;
	}

	for (ii in obj[key]) {
		nobj = caDeepCopy(obj[key][ii]);

		if (!(nobj instanceof Object)) {
			this.error('%s[%s] is not an object or array', key, ii);
			continue;
		}

		nobj['name'] = ii;
		method(caSprintf('%s[%s]', key, ii), nobj);
	}
};

/* [private] */
caMetricMetadata.prototype.addType = function (name, type)
{
	var hasunit, hasbase;

	if (!this.checkPresentType(name, type, 'name', ''))
		return;

	this.checkText(name + ' name', type['name']);

	if (!this.checkPresentType(name, type, 'arity', ''))
		return;

	if (type['arity'] != 'numeric' && type['arity'] != 'discrete')
		this.error('%s: "arity" must be "numeric" or "discrete"', name);

	hasunit = this.checkPresentType(name, type, 'unit', '', true);
	this.checkPresentType(name, type, 'minmax', 0, true);

	hasbase = this.checkPresentType(name, type, 'base', 0, true);

	if (hasbase) {
		if (type['base'] != 2 && type['base'] != 10)
			this.error('%s: "base" must be 2 or 10', name);

		if (!hasunit)
			this.error('%s: must specify "unit" with "base"', name);
	}

	if (this.checkPresentType(name, type, 'power', 0, true) && !hasbase)
		this.error('%s: must specify "base" with "power"', name);

	if (!hasunit)
		type['unit'] = '';

	this.insert(name, this.cmm_types, type['name'], type);
};

/* [private] */
caMetricMetadata.prototype.addField = function (name, field)
{
	if (!this.checkPresentType(name, field, 'name', ''))
		return;

	this.checkText(name + ' name', field['name']);
	this.checkPresentType(name, field, 'label', '');
	if (this.checkPresentType(name, field, 'type', '', true) &&
	    !(field['type'] in this.cmm_types))
		this.error('%s: no such type "%s"', name, field['type']);

	this.insert(name, this.cmm_fields, field['name'], field);
};

/* [private] */
caMetricMetadata.prototype.addModule = function (name, module)
{
	if (!this.checkPresentType(name, module, 'name', '') ||
	    !this.checkPresentType(name, module, 'label', ''))
		return;

	this.checkText(name + ' name', module['name']);
	this.insert(name, this.cmm_modules, module['name'], module);
};

/* [private] */
caMetricMetadata.prototype.addMetric = function (name, metric)
{
	var field, ii, statname;

	if (!this.checkPresentType(name, metric, 'module', '') ||
	    !this.checkPresentType(name, metric, 'stat', '') ||
	    !this.checkPresentType(name, metric, 'label', '') ||
	    !this.checkPresentType(name, metric, 'fields', []))
		return;

	this.checkText(name + ' stat', metric['stat']);

	if (!this.checkPresentType(name, metric, 'unit', '', true) &&
	    !this.checkPresentType(name, metric, 'type', '', true))
		this.error('%s: "unit" or "type" must be specified', name);

	if (!(metric['module'] in this.cmm_modules))
		this.error('%s: no such module: "%s"', name, metric['module']);

	if ('type' in metric && !(metric['type'] in this.cmm_types))
		this.error('%s: no such type: "%s"', name, metric['type']);

	for (ii = 0; ii < metric['fields'].length; ii++) {
		field = metric['fields'][ii];
		if (!(field in this.cmm_fields))
			this.error('%s: no such field: "%s"', name, field);
	}

	if (!('interval' in metric))
		metric['interval'] = 'interval';
	if (metric['interval'] != 'interval' && metric['interval'] != 'point')
		this.error('%s: "aggregate" must be one of "interval" or ' +
		    '"point"', name);

	statname = metric['module'] + '.' + metric['stat'];

	if (!(statname in this.cmm_metrics)) {
		this.cmm_metrics[statname] = metric;
		return;
	}

	if (this.cmm_metrics[statname]['interval'] == 'interval' &&
	    metric['interval'] !== 'interval') {
		/*
		 * This likely isn't a conflict, but rather we've upgraded the
		 * instrumenter to a version that supports this property.
		 */
		this.cmm_metrics[statname]['interval'] = metric['interval'];
	}

	if (this.cmm_metrics[statname]['label'] != metric['label'] ||
	    this.cmm_metrics[statname]['type'] !== metric['type'] ||
	    this.cmm_metrics[statname]['unit'] !== metric['unit']) {
		this.error('%s: conflict: have %j, got %j', name,
		    this.cmm_metrics[statname], metric);
		return;
	}

	this.cmm_metrics[statname]['fields'] = caArrayMerge(
	    this.cmm_metrics[statname]['fields'], metric['fields']);
};

/*
 * Returns the errors encountered while parsing the metadata (as strings).
 */
caMetricMetadata.prototype.problems = function ()
{
	return (this.cmm_messages);
};

/*
 * Write a summary of this metadata to the stream "out".
 */
caMetricMetadata.prototype.report = function (out, abbreviated)
{
	var printf, list, ii, elt;
	printf = function () { out.write(caSprintf.apply(null, arguments)); };

	if (!abbreviated)
		printf('Metrics\n');

	printf('    %-20s  %-40s  %s\n', 'MODULE', 'STAT', 'UNIT');
	list = Object.keys(this.cmm_metrics);
	for (ii = 0; ii < list.length; ii++) {
		elt = this.cmm_metrics[list[ii]];
		printf('    %-20s  %-40s  %s\n',
		    this.moduleLabel(elt['module']),
		    this.metricLabel(elt['module'], elt['stat']),
		    this.metricUnit(elt['module'], elt['stat']));
	}

	if (abbreviated)
		return;

	printf('\nTypes: %s\n', Object.keys(this.cmm_types).sort().join(', '));

	printf('\nFields\n');
	printf('    %-15s  %-10s  %-10s  %-10s  %s\n',
	    'FIELD', 'TYPE', 'ARITY', 'UNIT', 'LABEL');
	list = Object.keys(this.cmm_fields).sort();
	for (ii = 0; ii < list.length; ii++) {
		printf('    %-15s  %-10s  %-10s  %-10s  %s\n', list[ii],
		    this.cmm_fields[list[ii]]['type'] || '<default>',
		    this.fieldArity(list[ii]),
		    this.fieldUnit(null, null, list[ii]) || '<metric>',
		    this.fieldLabel(list[ii]));
	}
};

/*
 * Return a new metric set from this metadata.
 */
caMetricMetadata.prototype.metricSet = function ()
{
	var set, key, mm;

	set = new caMetricSet();
	for (key in this.cmm_metrics) {
		mm = this.cmm_metrics[key];
		set.addMetric(mm['module'], mm['stat'], mm['fields']);
	}

	return (set);
};

/*
 * Return the label for the given module.
 */
caMetricMetadata.prototype.moduleLabel = function (module)
{
	return (this.cmm_modules[module]['label']);
};

/*
 * Return the label for the given base metric.
 */
caMetricMetadata.prototype.metricLabel = function (module, stat)
{
	var statname = module + '.' + stat;
	return (this.cmm_metrics[statname]['label']);
};

/*
 * Return the type for the given base metric, or undefined if none exists.
 */
caMetricMetadata.prototype.metricType = function (module, stat)
{
	var statname = module + '.' + stat;
	return (this.cmm_metrics[statname]['type']);
};

/*
 * Return the unit for the given base metric.
 */
caMetricMetadata.prototype.metricUnit = function (module, stat)
{
	var statname, metric;

	statname = module + '.' + stat;
	metric = this.cmm_metrics[statname];

	if ('unit' in metric)
		return (metric['unit']);

	return (this.cmm_types[metric['type']]['unit']);
};

/*
 * Return the interval type for the given base metric.
 */
caMetricMetadata.prototype.metricInterval = function (module, stat)
{
	var statname = module + '.' + stat;
	return (this.cmm_metrics[statname]['interval']);
};

/*
 * Return the label for the given field name.
 */
caMetricMetadata.prototype.fieldLabel = function (fieldname)
{
	if (!(fieldname in this.cmm_fields))
		return (null);

	return (this.cmm_fields[fieldname]['label']);
};

/*
 * Return the type for the given field name, or undefined if there's none.
 */
caMetricMetadata.prototype.fieldType = function (fieldname)
{
	if (!(fieldname in this.cmm_fields))
		return (null);

	return (this.cmm_fields[fieldname]['type'] || 'string');
};

/*
 * Return the arity for the given field.
 */
caMetricMetadata.prototype.fieldArity = function (fieldname)
{
	var field, type;

	field = this.cmm_fields[fieldname];
	if (!('type' in field))
		return ('discrete');

	type = this.cmm_types[field['type']];
	return (type['arity']);
};

/*
 * Return the units for the given field.
 */
caMetricMetadata.prototype.fieldUnit = function (module, stat, fieldname)
{
	var field;

	field = this.cmm_fields[fieldname];
	if ('type' in field)
		return (this.cmm_types[field['type']]['unit']);

	if (!module || !stat)
		return (null);

	return (this.metricUnit(module, stat));
};

/*
 * Return details for the given type.
 */
caMetricMetadata.prototype.type = function (type)
{
	return (caDeepCopy(this.cmm_types[type]));
};

/*
 * Returns a JSON representation of this metric set in the format specified by
 * the CA HTTP API's "metrics" resources.
 */
function caMetricHttpSerialize(set, metadata)
{
	var metrics, metric, module, stat, field, type;
	var ret, obj, ii, jj;

	ret = {
	    modules: {},
	    fields: {},
	    types: {},
	    metrics: []
	};

	metrics = set.baseMetrics();

	for (ii = 0; ii < metrics.length; ii++) {
		metric = metrics[ii];
		module = metric.module();
			stat = metric.stat();

		if (!(module in ret['modules'])) {
			ret['modules'][module] = {
			    label: metadata.moduleLabel(module)
			};
		}

		obj = {
		    module: module,
		    stat: stat,
		    label: metadata.metricLabel(module, stat),
		    interval: metadata.metricInterval(module, stat),
		    fields: metric.fields()
		};

		type = metadata.metricType(module, stat);

		if (type) {
			obj['type'] = type;

			if (!(type in ret['types']))
				ret['types'][type] = metadata.type(type);
		} else {
			obj['unit'] = metadata.metricUnit(module, stat);
		}

		for (jj = 0; jj < obj['fields'].length; jj++) {
			field = obj['fields'][jj];
			if (field in ret['fields'])
				continue;

			type = metadata.fieldType(field);

			ret['fields'][field] = {
			    label: metadata.fieldLabel(field),
			    type: type
			};

			if (!(type in ret['types']))
				ret['types'][type] = metadata.type(type);
		}

		ret['metrics'].push(obj);
	}

	return (ret);
}

exports.caMetricSet = caMetricSet;
exports.caMetricMetadata = caMetricMetadata;
exports.caMetricHttpSerialize = caMetricHttpSerialize;
