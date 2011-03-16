/*
 * ca-metric.js: supporting facilities for managing metrics
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('./ca-common');

/*
 * Encapsulates the set of metrics managed by the configuration service.  This
 * is queried for the details of particular metrics.
 */
function caMetricSet()
{
	/*
	 * We store the information in two ways:
	 *    cms_modules	All metrics indexed by module name.
	 *
	 *    	Each module object contains these keys:
	 *
	 *		label	human-readable module name
	 *
	 *		stats	maps stat name => stat object
	 *
	 *	Each stat object contains these keys:
	 *
	 *		label	human-readable stat name
	 *
	 *		type	stat type enum (string)
	 *
	 *		fields	maps field name => field object
	 *
	 *	Each field object contains these keys:
	 *
	 *		label	human-readable field name
	 *
	 *		type	field type enum (string)
	 *
	 *    cms_byhost	Supported metrics by host name.  The structure
	 *    			of this object is:
	 *
	 *		host => supported module names =>
	 *		supported stat names => supported field names
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
	var mm, ss, ff;
	var mod, stat, field;
	var mstats, mfields;
	var byhost;

	byhost = this.cms_byhost[host] = {};

	for (mm = 0; mm < metrics.length; mm++) {
		mod = metrics[mm];

		if (!(mod.cam_name in this.cms_modules)) {
			this.cms_modules[mod.cam_name] = {
				stats: {},
				label: mod.cam_description
			};
		}

		mstats = this.cms_modules[mod.cam_name]['stats'];
		byhost[mod.cam_name] = {};

		for (ss = 0; ss < mod.cam_stats.length; ss++) {
			stat = mod.cam_stats[ss];

			if (!(stat.cas_name in mstats)) {
				mstats[stat.cas_name] = {
				    label: stat.cas_description,
				    type: stat.cas_type,
				    fields: {}
				};
			}

			byhost[mod.cam_name][stat.cas_name] = {};
			mfields = mstats[stat.cas_name]['fields'];

			for (ff = 0; ff < stat.cas_fields.length; ff++) {
				field = stat.cas_fields[ff];
				byhost[mod.cam_name][stat.cas_name]
				    [field.caf_name] = true;
				mfields[field.caf_name] = {
				    type: field.caf_type,
				    label: field.caf_description
				};
			}
		}
	}
};

/*
 * Add a metric from the form used by profiles, which is an object with just
 * "module", "stat", and "fields".  There are no labels or types.  Currently we
 * fake these up because they won't matter for such sets, but we should really
 * extract this metadata somewhere else.
 */
caMetricSet.prototype.addMetric = function (module, stat, fields)
{
	var ii, statfields;

	if (!(module in this.cms_modules))
		this.cms_modules[module] = { stats: {} };

	if (!(stat in this.cms_modules[module]['stats']))
		this.cms_modules[module]['stats'][stat] = {
		    fields: {}
		};

	statfields = this.cms_modules[module]['stats'][stat]['fields'];
	for (ii = 0; ii < fields.length; ii++)
		statfields[fields[ii]] =
		    { label: '', type: '' };
};

/*
 * Returns a caMetric instance for the metric identified by the specified module
 * and stat, if such a metric exists in this set.  Returns null otherwise.
 */
caMetricSet.prototype.baseMetric = function (module, stat)
{
	if (!(module in this.cms_modules))
		return (null);

	if (!(stat in this.cms_modules[module]['stats']))
		return (null);

	return (new caMetric(module, stat, this.cms_modules));
};

/*
 * Returns whether the metric identified by the given base metric (an instance
 * of caMetric) and a set of fields is contained within this MetricSet and
 * supported by the named "host".  If no "host" is specified, then returns true
 * if any host supports the specified metrics.
 */
caMetricSet.prototype.supports = function (metric, fields, host)
{
	var ii, supfields, module, stat;

	module = metric.module();
	stat = metric.stat();

	if (host === undefined) {
		if (!(module in this.cms_modules) ||
		    !(stat in this.cms_modules[module]['stats']))
			return (false);

		supfields = this.cms_modules[module]['stats'][stat]['fields'];
	} else {
		if (!(host in this.cms_byhost) ||
		    !(module in this.cms_byhost[host]) ||
		    !(stat in this.cms_byhost[host][module]))
			return (false);

		supfields = this.cms_byhost[host][module][stat];
	}

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

		lstats = lhs.cms_modules[modname]['stats'];
		rstats = rhs.cms_modules[modname]['stats'];

		for (statname in lstats) {
			if (!(statname in rstats))
				continue;

			lfields = lstats[statname]['fields'];
			rfields = rstats[statname]['fields'];

			this.addInternal(lhs.cms_modules, modname, statname);

			for (fieldname in lfields) {
				if (!(fieldname in rfields))
					continue;

				this.addInternal(lhs.cms_modules, modname,
				    statname, fieldname);
			}
		}
	}
};

/*
 * [internal] Adds the specified module/stat/field combination.
 */
caMetricSet.prototype.addInternal = function (modules, modname, statname,
    fieldname)
{
	var myfields, mstats, istats, newfield;

	if (!(modname in this.cms_modules))
		this.cms_modules[modname] = { stats: {} };

	if (!this.cms_modules[modname]['label'])
		this.cms_modules[modname]['label'] =
		    modules[modname]['label'];

	mstats = this.cms_modules[modname]['stats'];
	istats = modules[modname]['stats'];
	if (!(statname in this.cms_modules[modname]['stats']))
		mstats[statname] = { fields: {} };

	if (!mstats[statname]['label'])
		mstats[statname]['label'] = istats[statname]['label'];
	if (!mstats[statname]['type'])
		mstats[statname]['type'] = istats[statname]['type'];

	if (arguments.length < 4)
		return;

	myfields = mstats[statname]['fields'];

	if (!(fieldname in myfields))
		myfields[fieldname] = {};

	newfield = istats[statname]['fields'][fieldname];
	if (!myfields[fieldname]['label'])
		myfields[fieldname]['label'] = newfield['label'];
	if (!myfields[fieldname]['type'])
		myfields[fieldname]['type'] = newfield['type'];
};

/*
 * Returns a JSON representation of this metric set in the format specified by
 * the CA HTTP API's "metrics" resources.
 */
caMetricSet.prototype.toJson = function ()
{
	/*
	 * The fact that our internal representation exactly matches what we're
	 * sending to the user should be considered a remarkable coincidence.
	 * The internal representation can be changed as long as this function
	 * is updated appropriately.
	 */
	return (caDeepCopy(this.cms_modules));
};

/*
 * Represents a single base metric.
 */
function caMetric(module, stat, data)
{
	var fields, fieldname;

	this.cm_module = module;
	this.cm_stat = stat;
	this.cm_fieldtypes = {};

	fields = data[module]['stats'][stat]['fields'];

	for (fieldname in fields)
		this.cm_fieldtypes[fieldname] = fields[fieldname]['type'];
}

caMetric.prototype.module = function () { return (this.cm_module); };
caMetric.prototype.stat = function () { return (this.cm_stat); };

/*
 * Returns an object mapping field names to the corresponding field's type.
 */
caMetric.prototype.fieldTypes = function ()
{
	return (caDeepCopy(this.cm_fieldtypes));
};

/*
 * Our only interface to the outside world is the caMetricSet constructor.
 */
exports.caMetricSet = caMetricSet;


/*
 * This utility function converts a shorthand description of metrics (which
 * looks like our internal representation) to the form that would be used on the
 * wire in AMQP.
 */
function caMetricsExpand(metrics)
{
	var mm, ss, ff;
	var mod, stat, ifield;
	var ret = [];

	for (mm in metrics) {
		mod = {
		    cam_name: mm,
		    cam_description: metrics[mm]['label'],
		    cam_version: '0.0',
		    cam_stats: []
		};

		for (ss in metrics[mm]['stats']) {
			stat = {
			    cas_name: ss,
			    cas_description: metrics[mm]['stats'][ss]['label'],
			    cas_type: metrics[mm]['stats'][ss]['type'],
			    cas_fields: []
			};

			for (ff in metrics[mm]['stats'][ss]['fields']) {
				ifield = metrics[mm]['stats'][ss]['fields'][ff];
				stat.cas_fields.push({
				    caf_name: ff,
				    caf_type: ifield['type'],
				    caf_description: ifield['label']
				});
			}

			mod.cam_stats.push(stat);
		}

		ret.push(mod);
	}

	return (ret);
}

exports.caMetricsExpand = caMetricsExpand;
