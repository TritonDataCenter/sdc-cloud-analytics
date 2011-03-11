/*
 * ca-profile.js: profile support
 *
 * Profiles are sets of metrics.  They can be used to limit visibility of
 * metrics based on module, stat, or field names, or to suggest a group of
 * metrics to a user for a particular use case.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('./ca-common');

/*
 * Manages the set of profiles built into CA, which are defined with metadata.
 */
function caProfileManager()
{
	this.cpm_profiles = {};
}

/*
 * Given a handle to the metadata manager, load the profiles from metadata.
 */
caProfileManager.prototype.load = function (mdmgr)
{
	var names, ii, profile;

	this.cpm_profiles = {};
	names = mdmgr.list('profile');
	for (ii = 0; ii < names.length; ii++) {
		profile = new caProfile(mdmgr.get('profile', names[ii]));
		this.cpm_profiles[names[ii]] = profile;
	}
};

/*
 * Retrieve the named profile.
 */
caProfileManager.prototype.get = function (name)
{
	return (this.cpm_profiles[name]);
};

/*
 * Retrieve a profile that encapsulates the specified metrics.  The binding is
 * lazy so if these metrics are changed later subsequent calls will use the
 * updated metrics.
 */
caProfileManager.prototype.forMetrics = function (metrics)
{
	return (new caMetricsProfile(metrics));
};

/*
 * While the caProfile class is not exposed directly, instances of this class
 * are returned to consumers via caProfileManager.get().  This allows consumers
 * to check whether metrics are contained within a given profile.
 */
function caProfile(metadata)
{
	this.load(metadata);
}

caProfile.prototype.load = function (metadata)
{
	var metrics, ii, mm, ss, jj, ff;

	caProfileValidate(metadata);

	this.cp_name = metadata['name'];
	this.cp_label = metadata['label'];
	this.cp_metrics = {};

	metrics = metadata['metrics'];
	for (ii = 0; ii < metrics.length; ii++) {
		mm = metrics[ii];

		if (!(this.cp_metrics[mm['module']]))
			this.cp_metrics[mm['module']] = {};

		ASSERT(!(mm['stat'] in this.cp_metrics[mm['module']]));
		ss = this.cp_metrics[mm['module']][mm['stat']] = { fields: {} };

		for (jj = 0; jj < mm['fields'].length; jj++) {
			ff = mm['fields'][jj];
			ASSERT(!(ff in ss['fields']));
			ss['fields'][ff] = true;
		}
	}
};

caProfile.prototype.name = function ()
{
	return (this.cp_name);
};

caProfile.prototype.label = function ()
{
	return (this.cp_label);
};

/*
 * Return null if this profile contains the specified metric, identified as an
 * object with a "module", "stat", and "fields" parameter, where "fields" is the
 * set of fields used by either a predicate or decomposition.  Returns an error
 * otherwise.
 */
caProfile.prototype.validateMetric = function (metric)
{
	var fields, ii;

	ASSERT(metric['module']);
	ASSERT(metric['stat']);
	ASSERT(metric['fields']);

	if (!(metric['module'] in this.cp_metrics))
		return (new caInvalidFieldError('module', metric['module'],
		    'module does not exist in profile "%s"', this.cp_name));

	if (!(metric['stat'] in this.cp_metrics[metric['module']]))
		return (new caInvalidFieldError('stat', metric['stat'],
		    'module does not exist in module "%s" in profile "%s"',
		    metric['module'], this.cp_name));

	fields = this.cp_metrics[metric['module']][metric['stat']]['fields'];

	for (ii = 0; ii < metric['fields'].length; ii++) {
		if (!(metric['fields'][ii] in fields))
			return (new caInvalidFieldError('fields',
			    metric['fields'], 'field "%s" does not exist in ' +
			    'module "%s" stat "%s" in profile "%s"',
			    metric['fields'][ii], metric['module'],
			    metric['stat'], this.cp_name));
	}

	return (null);
};

/*
 * Given a set of metrics, return the subset that are contained in this profile.
 * This function knows a little too much about the structure of the input data.
 */
caProfile.prototype.project = function (metrics)
{
	var mmf, mmfs, pmfs, modname, statname, ret;

	ret = {};
	for (modname in metrics) {
		if (!(modname in this.cp_metrics))
			continue;

		for (statname in metrics[modname]['stats']) {
			if (!(statname in this.cp_metrics[modname]))
				continue;

			if (!ret[modname]) {
				ret[modname] = caDeepCopy(metrics[modname]);
				ret[modname]['stats'] = {};
			}

			ret[modname]['stats'][statname] =
			    caDeepCopy(metrics[modname]['stats'][statname]);
			ret[modname]['stats'][statname]['fields'] = {};

			mmfs = metrics[modname]['stats'][statname]['fields'];
			pmfs = this.cp_metrics[modname][statname]['fields'];
			for (mmf in mmfs) {
				if (!(mmf in pmfs))
					continue;

				ret[modname]['stats'][statname]['fields'][mmf] =
				    caDeepCopy(mmfs[mmf]);
			}
		}
	}

	return (ret);
};

/*
 * Implementation of caProfile interface that contains the specified metrics.
 * This is only used in test code.
 */
function caMetricsProfile(metrics)
{
	this.cmp_metrics = metrics;
	this.update();
}

caMetricsProfile.prototype.update = function ()
{
	/*
	 * Cook up metadata for a fake profile for the specified metrics.  We do
	 * this every time we have to do anything because we want this binding
	 * to be lazy.
	 */
	var metrics, metadata, module, stat, field, metric;

	metrics = this.cmp_metrics;
	metadata = {
		name: 'all',
		label: 'all',
		metrics: []
	};

	for (module in metrics) {
		for (stat in metrics[module]['stats']) {
			metric = { module: module, stat: stat, fields: [] };

			for (field in metrics[module]['stats'][stat]['fields'])
				metric['fields'].push(field);

			metadata['metrics'].push(metric);
		}
	}

	this.cmp_profile = new caProfile(metadata);
};

caMetricsProfile.prototype.name = function () { return ('all'); };

caMetricsProfile.prototype.label = function () { return ('All'); };

caMetricsProfile.prototype.validateMetric = function (metric)
{
	this.update();
	return (this.cmp_profile.validateMetric(metric));
};

caMetricsProfile.prototype.project = function (metrics)
{
	this.update();
	return (this.cmp_profile.project(metrics));
};

function check_present(errors, label, obj, key, constructor)
{
	if (!(key in obj))
		return (errors.push(new caInvalidFieldError(key, '<none>',
		    '%s has no member "%s"', label, key)));

	if (!obj[key].constructor)
		return (errors.push(new caInvalidFieldError(key, obj[key],
		    '%s member "%s" invalid: illegal type', label, key)));

	if (obj[key].constructor !== constructor)
		return (errors.push(new caInvalidFieldError(key, obj[key],
		    '%s member "%s" has wrong type (expected %s)', label, key,
		    constructor.name)));

	return (null);
}

/*
 * Validates that the given profile (in metadata form) appears semantically
 * valid.  Checks for missing or duplicate fields, types, etc.  Returns an array
 * of errors.
 */
function caProfileValidate(profile)
{
	var metrics, fields, errors, nerrors, seenmetrics, seenfields;
	var mm, name, ii, jj;

	errors = [];
	check_present(errors, 'profile', profile, 'name', String);
	check_present(errors, 'profile', profile, 'label', String);
	check_present(errors, 'profile', profile, 'metrics', Array);

	metrics = profile['metrics'];

	if (metrics.length === 0)
		errors.push(new caInvalidFieldError('metrics'));

	seenmetrics = {};
	for (ii = 0; ii < metrics.length; ii++) {
		nerrors = errors.length;
		mm = metrics[ii];

		if (typeof (mm) != typeof ({}) || mm.constructor !== Object) {
			errors.push(new caInvalidFieldError(
			    'metric ' + (ii + 1), mm,
			    'metrics: element %d is not an object', ii));
			continue;
		}

		check_present(errors, 'metric ' + (ii + 1),
		    mm, 'module', String);
		check_present(errors, 'metric ' + (ii + 1),
		    mm, 'stat', String);

		if (errors.length > nerrors)
			continue;

		name = mm['module'] + '.' + mm['stat'];
		check_present(errors, 'metric ' + name,
		    mm, 'fields', Array);

		if (name in seenmetrics)
			errors.push(new caInvalidFieldError('metric ' + name,
			    '<complex>', 'duplicate base metric'));

		if (errors.length > nerrors)
			continue;

		seenmetrics[name] = true;
		fields = mm['fields'];
		seenfields = {};

		for (jj = 0; jj < fields.length; jj++) {
			if (typeof (fields[jj]) != typeof ('')) {
				errors.push(new caInvalidFieldError(
				    caSprintf('metric %s, field %d',
				    name, jj + 1), fields[jj], 'not a string'));
				continue;
			}

			if (fields[jj] in seenfields) {
				errors.push(new caInvalidFieldError(
				    caSprintf('metric %s: field "%s"', name,
				    fields[jj]), fields[jj], 'duplicate'));
				continue;
			}

			seenfields[fields[jj]] = true;
		}
	}

	/* JSSTYLED */
	return (errors);
}

/*
 * The only interface to the rest of the world is the profile manager and the
 * profile validator (for the "caprof" tool).  caProfile is exposed for testing
 * only.
 */
exports.caProfileManager = caProfileManager;
exports.caProfileValidate = caProfileValidate;
exports.caProfile = caProfile;
