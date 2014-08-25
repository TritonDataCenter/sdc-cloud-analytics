/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * tst.interval.js: test caAggrInterval
 */

var mod_assert = require('assert');
var mod_agg = require('../../lib/ca/ca-agg');

var now, nowms, when, interval;

now = 1234567890;
nowms = now * 1000;
when = 12345;

/*
 * Test inferring everything from the current time, duration, and granularity.
 */
interval = mod_agg.caAggrInterval({}, nowms, 1, 1);
mod_assert.deepEqual(interval, {
    start_time: now - 2,
    duration: 1
});

interval = mod_agg.caAggrInterval({}, nowms, 60, 10);
mod_assert.deepEqual(interval, {
    start_time: now - 70,
    duration: 60
});

interval = mod_agg.caAggrInterval({}, nowms, 60, 1);
mod_assert.deepEqual(interval, {
    start_time: now - 61,
    duration: 60
});

interval = mod_agg.caAggrInterval({}, nowms, 5, 5);
mod_assert.deepEqual(interval, {
    start_time: now - 10,
    duration: 5
});

/*
 * Specify just start_time.
 */
interval = mod_agg.caAggrInterval({ start_time: when }, nowms, 1, 1);
mod_assert.deepEqual(interval, {
    start_time: when,
    duration: 1
});

interval = mod_agg.caAggrInterval({ start_time: when }, nowms, 30, 5);
mod_assert.deepEqual(interval, {
    start_time: when,
    duration: 30
});

/*
 * Specify just duration.
 */
interval = mod_agg.caAggrInterval({ duration: 10 }, nowms, 1, 1);
mod_assert.deepEqual(interval, {
    start_time: now - 11,
    duration: 10
});

interval = mod_agg.caAggrInterval({ duration: 20 }, nowms, 60, 5);
mod_assert.deepEqual(interval, {
    start_time: now - 25,
    duration: 20
});

/*
 * Specify just end_time.
 */
interval = mod_agg.caAggrInterval({ end_time: when }, nowms, 1, 1);
mod_assert.deepEqual(interval, {
    start_time: when - 1,
    duration: 1
});

interval = mod_agg.caAggrInterval({ end_time: when }, nowms, 60, 5);
mod_assert.deepEqual(interval, {
    start_time: when - 60,
    duration: 60
});

/*
 * Specify both start_time and duration.
 */
interval = mod_agg.caAggrInterval({
    start_time: when,
    duration: 10
}, nowms, 1, 1);
mod_assert.deepEqual(interval, {
    start_time: when,
    duration: 10
});

interval = mod_agg.caAggrInterval({
    start_time: when,
    duration: 10
}, nowms, 60, 5);
mod_assert.deepEqual(interval, {
    start_time: when,
    duration: 10
});

/*
 * Specify both end_time and duration.
 */
interval = mod_agg.caAggrInterval({
    end_time: when,
    duration: 10
}, nowms, 1, 1);
mod_assert.deepEqual(interval, {
    start_time: when - 10,
    duration: 10
});

interval = mod_agg.caAggrInterval({
    end_time: when,
    duration: 10
}, nowms, 60, 5);
mod_assert.deepEqual(interval, {
    start_time: when - 10,
    duration: 10
});

/*
 * Specify both start_time and end_time.
 */
interval = mod_agg.caAggrInterval({
    start_time: when,
    end_time: when + 1
}, nowms, 1, 1);
mod_assert.deepEqual(interval, {
    start_time: when,
    duration: 1
});

interval = mod_agg.caAggrInterval({
    start_time: when,
    end_time: when + 10
}, nowms, 60, 5);
mod_assert.deepEqual(interval, {
    start_time: when,
    duration: 10
});

/*
 * Specify all three.
 */
interval = mod_agg.caAggrInterval({
    start_time: when,
    duration: 1,
    end_time: when + 1
}, nowms, 1, 1);
mod_assert.deepEqual(interval, {
    start_time: when,
    duration: 1
});

interval = mod_agg.caAggrInterval({
    start_time: when,
    duration: 10,
    end_time: when + 10
}, nowms, 60, 5);
mod_assert.deepEqual(interval, {
    start_time: when,
    duration: 10
});

/*
 * Error cases
 */
mod_assert.throws(function () {
	mod_agg.caAggrInterval({
	    start_time: when,
	    duration: 10,
	    end_time: when + 1
	}, nowms, 1, 1);
	/* JSSTYLED */
    }, /"start_time" \+ "duration" must equal "end_time"/);

mod_assert.throws(function () {
	mod_agg.caAggrInterval({
	    start_time: when,
	    end_time: when - 1
	}, nowms, 1, 1);
	/* JSSTYLED */
    }, /"end_time" must be later than "start_time"/);

mod_assert.throws(function () {
	mod_agg.caAggrInterval({
	    start_time: when,
	    end_time: when
	}, nowms, 1, 1);
	/* JSSTYLED */
    }, /"end_time" must be later than "start_time"/);

mod_assert.throws(function () {
	mod_agg.caAggrInterval({
	    end_time: 10,
	    duration: 11
	}, nowms, 1, 1);
	/* JSSTYLED */
    }, /"duration" cannot exceed "end_time"/);
