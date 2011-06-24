# Cloud Analytics

Cloud Analytics provides deep observability for systems and applications in a
SmartDataCenter cloud.  The CA service enables operators and end users to
dynamically instrument systems in the cloud to collect performance data that can
be visualized in real-time through the operator or customer portals or analyzed
using the API.  This data can be collected and saved indefinitely for capacity
planning and other historical analysis.

# Overview

## CA Service

Operators and end users interface with the Cloud Analytics service either
directly through the CA HTTP REST API (part of the Cloud API) or through a
portal which itself uses the REST API.  The CA API allows users to:

* list available metrics and fields
* create and delete instrumentations
* retrieve values for instrumentations

These concepts will are explained under "Building blocks" below.

For simplicity, this documentation assumes that parameters, payloads, and return
values are all specified using JSON, though the API may support other formats.
The rest of the examples in this document will use "curl" to make requests and
JSON for responses.


## Building blocks: metrics, instrumentations, and fields

A **metric** is any quantity that can be instrumented using CA.  For examples:

* Disk I/O operations
* Kernel thread executions
* TCP connections established
* MySQL queries
* HTTP server operations
* System load average

Each metric also defines what **fields** are available when data is collected.
These fields can be used to filter or decompose data.  For example, the Disk I/O
operations metric provides fields "hostname" (for the current server's
hostname) and "disk" (for the name of the disk actually performing an
operation).

You can list the available metrics using the API:

	# curl $casvc/ca
	{
		"metrics": [ {
			"module": "disk",
			"stat": "physio_ops",
			"label": "I/O operations",
			"interval": "interval",
			"fields": [ "hostname", "disk", "optype", "latency",
			    "size", "offset" ],
			"unit": "operations"
		}, ...  ], ...
	}

The "module" and "stat" properties identify the metric.  The "/ca" resource
lists a lot of information about the CA service.  For details and information
about the other properties of each "metric" object, see the API documentation.

When you want to actually gather data for a metric, you create an
**instrumentation**.  The instrumentation specifies:

* which metric to collect
* an optional **filter** based on the metric's fields (e.g., only collect data
  from certain hosts, or for zones owned by a particular customer)
* an optional decomposition based on the metric's fields (e.g., break down the
  results by server hostname)
* how frequently to aggregate data (e.g., every second, every hour, etc.)
* how much data to keep (e.g., 10 minutes' worth, 6 months' worth, etc.)
* other configuration options

Continuing the above example, if the system provides the metric "Disk I/O
operations" with fields "hostname" and "disk", an example instrumentation might
specify:

* to collect data for the "Disk I/O operations" metric (the *metric*)
* to collect the data once per second and store it for 10 minutes
* to only collect data from host "hostA" (a *predicate*)
* to break out the results by disk name (a *decomposition*)

When this instrumentation is created, the system instruments the software on
hostA to start gathering the requested information and report it to the CA
service.  You can then retrieve its value for any time in the last 10 minutes
and get back a list of the number of disk I/O operations completed during that
second on server "hostA" broken down by disk name.

Here's an example of creating such an instrumentation.  For syntax details, see
the documentation:

	# cat request.json 
	{
		"module": "disk",
		"stat": "physio_ops"
		"granularity": 1,
		"retention-time": 600,
		"predicate": { "eq": [ "hostname", "headnode" },
		"decomposition": [ "disk" ]
	}

	# curl -X POST $casvc/ca/instrumentations -Trequest.json \
	    -H 'Content-type: application/json'
	{
		"module": "disk",
		"stat": "physio_ops",
		"predicate": { "eq": [ "hostname", "headnode" ] },
		"decomposition": [ "disk" ],
		"value-dimension": 2,
		"value-arity": "discrete-decomposition",
		"enabled": true,
		"retention-time": 600,
		"idle-max": 3600,
		"transformations": {},
		"nsources": 1,
		"granularity": 1,
		"persist-data": false,
		"crtime": 1308862234757,
		"value-scope": "interval",
		"uri": "/ca/instrumentations/16",
		"id": "16",
		"uris": [ {
		    "uri": "/ca/instrumentations/16/value/raw",
		    "name": "value_raw"
		} ],
		"warnings": []
	}

When we create this instrumentation, the system dynamically instruments the
relevant software and starts gathering data.  The data is made available
immediately in real-time.  To get the data for a particular point in time, you
retrieve the **value** of the instrumentation for that time:

	# curl $casvc/ca/instrumentations/16/value/raw
	{
		"value": {
		  "sd0": 1249,
		  "cmdk0": 0
		},
		"transformations": {},
		"start_time": 1308862501,
		"duration": 1,
		"nsources": 1,
		"minreporting": 1,
		"requested_start_time": 1308862501,
		"requested_duration": 1,
		"requested_end_time": 1308862502
	}	

To summarize: *metrics* define what data the system is capable of reporting.
*Fields* enhance the raw numbers with additional metadata about each event that
can be used for filtering and decomposition.  *Instrumentations* specify which
metrics to actually collect, what additional information to collect from each
metric, and how to store that data.  When you want to retrieve that data, you
query the service for the *value* of the instrumentation.


## Values and visualizations

We showed above how fields can be used to decompose results.  Let's look at that
in more detail.  We'll continue using the "Disk I/O operations" metric with
fields "hostname", and "disk".

### Scalar values

Suppose we create an instrumentation with no filter and no decomposition.  Then
the value of the instrumentation for a particular time interval might look
something like this (omitting several unrelated properties):

	{
		start_time: 1308789361,
		duration: 1,
		value: 573
	}

In this case, `start_time` denotes the start of the time interval in Unix time,
`duration` denotes the length of the interval, and `value` denotes the actual
value, which is 573.  This means that 573 disk I/O operations completed on all
systems in the cloud between times 1308789361 and 1308789362.

### Discrete decompositions

Now suppose we create a new instrumentation with a decomposition by hostname.
Then the raw value might look something like this:

	{
		start_time: 1308789361,
		duration: 1,
		value: {
			host1: 152,
			host2: 49,
			host3: 287,
			host4: 5
		}
	}

We call the decomposition by "hostname" a **discrete decomposition** because the
possible values of hostname ("host1", "host2", ...) are not numbers.

Similarly, we could examine the disk operations specific to a particular host
(say "host1") and decompose that by disk name.  We could create a new
instrumentation for that and the value might look something like this:

	{
		start_time: 1308789361,
		duration: 1,
		value: {
			disk1: 16,
			disk2: 57,
			disk3: 12
		}
	}

### Numeric decompositions

It's also useful to decompose some metrics by numeric fields.  For example, you
might want to view disk I/O operations decomposed by latency, which is how long
the operation took.  Rather than breaking out every possible nanosecond value of
latency, the resulting value shows the *distribution*, grouping nearby latencies
into buckets and showing the number of disk I/O operations that fell into each
bucket.  The result looks like this:

	{
		"value": [
			[ [ 53000, 53999 ], 4 ],
			[ [ 54000, 54999 ], 4 ],
			[ [ 55000, 55999 ], 7 ],
			...
			[ [ 810000, 819999 ], 1 ]
		],
		"transformations": {},
		"start_time": 1308863061,
		"duration": 1,
		"nsources": 1,
		"minreporting": 1,
		"requested_start_time": 1308863061,
		"requested_duration": 1,
		"requested_end_time": 1308863062
	}

That data indicates that at time 1308863061, the system completed:

* 4 requests with latency between 53 and 54 microseconds,
* 4 requests with latency between 54 and 55 microseconds,
* 7 requests between 55 and 56 microseconds, and so on, and finally
* 1 request with latency between 810 and 820 microseconds.

This type of instrumentation is called a **numeric decomposition**.

### Combining decompositions

It's possible to combine a single discrete and numeric decomposition to produce 
an object mapping discrete key to numeric distribution, whose value looks like
this:

	{
		"value": {
			"sd0": [
				[ [ 110000, 119999 ], 1 ],
				[ [ 120000, 129999 ], 1 ],
				...
				[ [ 420000, 429999 ], 1 ],
				[ [ 25000000, 25999999 ], 1 ]
			]
		},
		"transformations": {},
		"start_time": 1308863799,
		"duration": 1,
		"nsources": 1,
		"minreporting": 1,
		"requested_start_time": 1308863799,
		"requested_duration": 1,
		"requested_end_time": 1308863800
	}

As we will see, this data allows clients to visualize the distribution of I/O
latency and then highlight individual disks in the distribution (or hosts, or
operation types, etc.).


### Value-related properties

We can now explain several of the instrumentation properties shown previously:

* `value-dimension`: the number of dimensions in returned values, which is
  the number of decompositions specified in the instrumentation, plus 1.
  Instrumentations with no decompositions have dimension 1 (scalar values).
  Instrumentations with a single discrete or numeric decomposition have value 2
  (vector values).  Instrumentations with both a discrete and numeric
  decomposition have value 3 (vector of vectors).
* `value-arity`: describes the format of individual values
    * `scalar`: the value is a scalar value (a number)
    * `discrete-decomposition`: the value is an object mapping discrete keys to
      scalars
    * `numeric-decomposition`: the value is either an object (really an array of
      arrays) mapping buckets (numeric ranges) to scalars, or an object mapping
      discrete keys to such an object.  That is, a numeric decomposition is one
      which contains at the leaf a distribution of numbers.

The arity serves as a hint to visualization clients: scalars are typically
rendered as line or bar graphs, discrete decompositions are rendered as stacked
or separate line or bar graphs, and numeric decompositions are rendered as
heatmaps.

### Heatmaps

Up to this point we have been showing **raw values**, which are JSON
representations of the data exactly as gathered by the Cloud Analytics service.
However, the service may provide other representations of the same data.  For
numeric decompositions, the service provides several **heatmap** resources that
generate heatmaps, like this one:

<img
src="http://wiki.joyent.com/download/attachments/1638994/20110309-c31dikt79k9iramtj5tsf2cjt8.jpg?version=1&modificationDate=1300115769000" />

Like raw values, heatmap values are returned using JSON, but instead of
specifying a `value` property, they specify an `image` property whose contents
are a base64-encoded PNG image.  For details, see the API reference.  Using the
API, it's possible to specify the size of the image, the colors used, which
values of the discrete decomposition to select, and many other properties
controlling the final result.

Heatmaps also provide a resource for getting the details of a particular heatmap
bucket, which looks like this:

	{
		"nbuckets": 100,
		"width": 600,
		"height": 300,
		"bucket_time": 1308865185,
		"bucket_ymin": 10000,
		"bucket_ymax": 19999,
		"present": {
			"sd0": 52
			"sd1": 57
		},
		"total": 1,
		"start_time": 1308865184,
		"duration": 60,
		"nsources": 1,
		"minreporting": 1,
		"requested_start_time": 1308865184,
		"requested_duration": 60,
		"requested_end_time": 1308865244
	}

This example indicates the following about the particular heatmap bucket we
clicked on:

* the time represented by the bucket is 1308865185
* the bucket covers a latency range between 10 and 20 microseconds
* at that time and latency range, disk `sd0` completed 52 operations and disk
  `sd1` completed 57 operations.

This level of detail is critical for understanding hot spots or other patterns
in the heatmap.


## Data granularity and data retention

By default, CA collects and saves data each second for 10 minutes.  So if you
create an instrumentation for disk I/O operations, the service will save
the per-second number of disk I/O operations going back for the last 10
minutes.  These parameters are configurable using the following instrumentation
properties:

* `granularity`: how frequently to aggregate data, in seconds.  The default is 1
  second.  For example, a value of 300 means to aggregate every 5 minutes' worth
  of data into a single data point.  The smaller this value, the more space the
  raw data takes up.  `granularity` cannot be changed after an instrumentation
  is created.
* `retention-time`: how long, in seconds, to keep each data point.  The default
  is 600 seconds (10 minutes).  The higher this value, the more space the raw
  data takes up.  `retention-time` can be changed after an instrumentation is
  created.

These values affect the space used by the instrumentation's data.  For example,
all things being equal, the following all store the same amount of data:

* 10 minutes' worth of per-second data (600 data points)
* 50 minutes' worth of per-5-second data
* 25 days' worth of per-hour data
* 600 days' worth of per-day data

The system imposes limits on these properties so that each instrumentation's
data cannot consume too much space.  The limits are expressed internally as a
number of data points, so you can adjust granularity and retention-time to match
your needs.  Typically, you'll be interested in either per-second data for live
performance analysis or an array of different granularities and retention-times
for historical usage patterns.


## Data persistence

By default, data collected by the CA service is only kept in memory, not
persisted on disk.  As a result, transient failures of underlying CA service
instances can result in loss of the collected data.  For live performance
analysis, this is likely not an issue, since the likelihood of a crash is low
and the data can probably be collected again.  For historical data being kept
for days, weeks, or even months, it's necessary to persist data to disk.  This
can be specified by setting the `persist-data` instrumentation property to
"true".  In that case, CA will ensure that data is persisted at approximately
the `granularity` interval of the instrumentation, but no more frequently than
every few minutes.  (For that reason, there's little value in persisting an
instrumentation whose retention time is only a few minutes.)


## Transformations

Transformations are post-processing functions that can be applied to data when
it's retrieved.  You do not need to specify transformations when you create an
instrumentation; you need only specify them when you retrieve the value.
Transformations map values of a discrete decomposition to something else.  For
example, a metric that reports HTTP operations decomposed by IP address supports
a transformation that performs a reverse-DNS lookup on each IP address, so that
you can view the results by hostname instead.  Another transformation maps IP
addresses to geolocation data for displaying incoming requests on a world map.

Each supported transformation has a name, like "reversedns".  When a
transformation is requested for a value, the returned value includes a
`transformations` object with keys corresponding to each transformation (e.g.,
"reversedns").  Each of these is an object mapping keys of the discrete
decomposition to transformed values.  For example:

	{
		"value": {
			"8.12.47.107": 57
		},
		"transformations": {
			"reversedns": {
				"8.12.47.107": [ "joyent.com" ]
			}
		},
		"start_time": 1308863799,
		"duration": 1,
		"nsources": 1,
		"minreporting": 1,
		"requested_start_time": 1308863799,
		"requested_duration": 1,
		"requested_end_time": 1308863800
	}
		
Transformations are always performed asynchronously and the results cached
internally for future requests.  So the first time you request a transformation
like "reversedns", you may see no values transformed at all.  As you retrieve
the value again, the system will have completed the reverse-DNS lookup for
addresses in the data and they will be included in the returned value.


# API Reference

## Global CA parameters
### Modules
### Metrics
### Fields
### Types
### Transformations
<!-- XXX move most of the content from Transformations above to here? -->
## Instrumentations
### Predicates
## Values
### Raw values
### Transformations
### Heatmap images
### Heatmap details
## Versioning and version history

The API version MUST be specified in the X-API-Version header.  This protocol
version is "ca/0.1.7".  All protocol versions start with "ca/" and end with a
semantic version number.  If no X-API-Version header is specified, version
"ca/0.1.0" is assumed.

The service does not limit itself to the specified version, but rather ensures
that all parameters are interpreted as specified in that version and that return
values are formatted as specified in that version when using features only
present in that version. In other words, if a request specifies version X, it
can still make use of features from version X+1. The server only cares about the
version for cases where the semantics of parameters changed from version X to
version X + 1, or the structure of return payloads changed between those
versions.

Changes in 0.1.7:

* "value-scope" property of instrumentations

Changes in 0.1.6:

* "ndatapoints" property of "value" resources and corresponding changes to
  return payloads "end_time" property of "value" resources

Changes in 0.1.5:

* "clone" resource

Changes in 0.1.4:

* "crtime" property of instrumentations
* "nbuckets", "width", "height" payload property for heatmap values
* "requested_start_time" and "requested_duration" payload properties for all
  values

Changes in 0.1.3:

* "id" property of instrumentations

Changes in 0.1.2:

* "persist-data" property of instrumentations

Changes in 0.1.1:

* "granularity" property of instrumentations
* "start_time" and "duration" properties of instrumentation values (rounded to
  multiples of "granularity")
