/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * cmd/cainst/modules/zfs.js: zfs/zpool instrumenter backend
 */

var mod_assert = require('assert');

var mod_ca = require('../../../lib/ca/ca-common');
var mod_capred = require('../../../lib/ca/ca-pred');
var mod_cazfs = require('../../../lib/ca/ca-zfs');

var inszLog;
var inszHostname;
var inszDataCache;

/*
 * Invoked by the instrumenter service to initialize the ZFS-based metrics.
 */
exports.insinit = function (instr, log, callback)
{
	inszLog = log;
	inszHostname = mod_ca.caSysinfo().ca_hostname;

	inszDataCache = {
	    dataset: new mod_cazfs.caZfsDataCache('zfs', mod_cazfs.caZfsData,
		inszLog),
	    pool: new mod_cazfs.caZfsDataCache('zpool', mod_cazfs.caZfsData,
		inszLog)
	};

	inszInitMetrics(instr);
	callback();
};

/*
 * Definitions of ZFS-based metrics.  Each metric (identified by module and
 * stat) has a scope (currently either "dataset" or "pool"), a list of columns
 * naming which fields of the "scope" object to retrieve, and a value function
 * that computes a single datum for an object of "scope" type.
 */
var inszMetrics = [ {
    module: 'zfs',
    stat: 'dataset_unused_quota',
    scope: 'dataset',
    columns: [ 'quota', 'used' ],
    value: function (dataset) {
	/*
	 * ZFS calculates available space for datasets with quotas as quota
	 * minus used, so that's what we show here, even though the "used" in
	 * this case isn't the same as what we show for "dataset_used" (see
	 * below).
	 */
	if (dataset['quota'] === 0)
		return (undefined);

	return (dataset['quota'] - dataset['used']);
    }
}, {
    module: 'zfs',
    stat: 'dataset_used',
    scope: 'dataset',
    columns: [ 'used', 'usedbychildren' ],
    value: function (dataset) {
	/*
	 * Recall that the "used" space of a dataset is the sum of
	 * usedbydataset, usedbychildren, usedbyrefreservation, and
	 * usedbysnapshots.  (See zfs(1M) if you don't recall this.)  Since
	 * we're reporting each dataset separately and adding them up to come up
	 * with a total, we want to ignore usedbychildren.
	 */
	return (dataset['used'] - dataset['usedbychildren']);
    }
}, {
    module: 'zfs',
    stat: 'dataset_quota',
    scope: 'dataset',
    columns: [ 'quota' ],
    value: function (dataset) {
	return (dataset['quota'] || undefined);
    }
}, {
    module: 'zfs',
    stat: 'pool_free',
    scope: 'pool',
    columns: [ 'free' ],
    value: function (dataset) { return (dataset['free']); }
}, {
    module: 'zfs',
    stat: 'pool_used',
    scope: 'pool',
    columns: [ 'allocated' ],
    value: function (dataset) { return (dataset['allocated']); }
}, {
    module: 'zfs',
    stat: 'pool_total',
    scope: 'pool',
    columns: [ 'size' ],
    value: function (dataset) { return (dataset['size']); }
} ];

/*
 * Registers the metrics defined above with the instrumenter service.
 */
function inszInitMetrics(instr)
{
	var fields = {};

	fields['dataset'] = [ 'hostname', 'zdataset' ];
	fields['pool'] = [ 'hostname', 'zpool' ];

	inszMetrics.forEach(function (def) {
		mod_assert.ok(def['scope'] in fields);
		mod_assert.ok(def['scope'] in inszDataCache);

		instr.registerMetric({
			module: def['module'],
			stat: def['stat'],
			fields: fields[def['scope']],
			impl: function (mm) {
				return (new inszMetricImpl(def, mm, instr,
				    inszDataCache[def['scope']]));
			}
		});
	});
}

/*
 * Implements the instrumenter's Metric interface for the zfs-based metric
 * desribed by "desc" and the actual instrumentation request described by
 * "metric".
 */
function inszMetricImpl(desc, metric, instrbei, source)
{
	var onlyzones;

	this.izm_scope = desc['scope'];
	this.izm_value = desc['value'];
	this.izm_columns = caDeepCopy(desc['columns']);
	this.izm_metric = caDeepCopy(metric);
	this.izm_source = source;
	this.izm_mkey = this.izm_scope == 'dataset' ? 'zdataset' : 'zpool';

	if (metric.is_zones) {
		mod_assert.equal(this.izm_scope, 'dataset');

		onlyzones = { or: metric.is_zones.map(function (zone) {
			return ({ eq: [ 'zdataset', 'zones/' + zone ] });
		}) };

		if (mod_capred.caPredNonTrivial(metric.is_predicate))
			this.izm_predicate = {
			    and: [ onlyzones, metric.is_predicate ]
			};
		else
			this.izm_predicate = onlyzones;

	} else {
		this.izm_predicate = metric.is_predicate;
	}

	this.izm_applypred = instrbei.applyPredicate.bind(instrbei,
	    this.izm_predicate);
	this.izm_compute = instrbei.computeValue.bind(instrbei,
	    {}, metric.is_decomposition);
}

inszMetricImpl.prototype.instrument = function (callback)
{
	var ii;

	if (inszLog)
		inszLog.info('instrumenting scope %s, columns %j: metric %j, ' +
		    'predicate %j', this.izm_scope, this.izm_columns,
		    this.izm_metric, this.izm_predicate);

	for (ii = 0; ii < this.izm_columns.length; ii++)
		this.izm_source.column(this.izm_columns[ii], true);

	callback();
};

inszMetricImpl.prototype.deinstrument = function (callback)
{
	var ii;

	for (ii = 0; ii < this.izm_columns.length; ii++)
		this.izm_source.column(this.izm_columns[ii], false);

	callback();
};

inszMetricImpl.prototype.value = function (callback)
{
	var impl, value, mkey;

	impl = this;
	value = this.izm_value;
	mkey = this.izm_mkey;

	this.izm_source.data(function (objects) {
		var datapts, datapt, key;

		if (!objects)
			return (callback(undefined));

		datapts = [];
		for (key in objects) {
			datapt = {
			    fields: { hostname: inszHostname },
			    value: value(objects[key])
			};
			datapt['fields'][mkey] = key;

			if (datapt['value'] === undefined)
				continue;

			datapts.push(datapt);
		}

		datapts = impl.izm_applypred(datapts);
		return (callback(impl.izm_compute(datapts)));
	});
};

exports.inszMetricImpl = inszMetricImpl;
