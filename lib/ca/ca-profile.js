/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

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
var mod_metric = require('./ca-metric');

/*
 * Manages the set of profiles built into CA, which are defined with metadata.
 */
function caProfileManager()
{
	this.cpm_profiles = {};
}

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

caProfileManager.prototype.get = function (name)
{
	return (this.cpm_profiles[name]);
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
	var metrics, ii;

	caProfileValidate(metadata);

	this.cp_name = metadata['name'];
	this.cp_label = metadata['label'];
	this.cp_metrics = new mod_metric.caMetricSet();

	metrics = metadata['metrics'];
	for (ii = 0; ii < metrics.length; ii++)
		this.cp_metrics.addMetric(metrics[ii]['module'],
		    metrics[ii]['stat'], metrics[ii]['fields']);
};

caProfile.prototype.name = function ()
{
	return (this.cp_name);
};

caProfile.prototype.label = function ()
{
	return (this.cp_label);
};

caProfile.prototype.metrics = function ()
{
	return (this.cp_metrics);
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
