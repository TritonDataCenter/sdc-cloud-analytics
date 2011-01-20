/*
 * caflot.js: flot-based visualization of CA metrics for demo purposes.
 * Note that variables declared here may be overwritten by cademo.js via the
 * pseudo-file cavars.js (included after caflot.js in graph.htm).
 */
var gServer = window.location.hostname;

var gPort = 23181;		/* config service HTTP port */
var gPlotWidth = 600;		/* plot width (pixels) */
var gPlotHeight = 300;		/* plot height (pixels) */
var gnBuckets = 50;		/* vertical buckets (for heatmaps) */
var gnDataPoints = 30;		/* number of data points to show */
var gMetrics = [];		/* all available metrics */
var gGraphs = {};		/* currently active graphs */

/*
 * Color management
 */
var gBaseColors = [ '#edc240', '#afd8f8', '#cb4b4b', '#4da74d', '#9440ed' ];
var gColors = [];
var gMaxSeries;

/*
 * Flot options
 */
var gScalarOptions = {
	series: { lines: { show: true, fill: true } },
	xaxis: { mode: 'time', ticks: 5 },
	yaxis: { min: 0 },
	legend: { show: false },
	grid: { clickable: true }
};

var gVectorOptions = {
	series: { lines: { show: true, fill: 0.8, lineWidth: 0 } },
	xaxis: { mode: 'time', ticks: 5 },
	yaxis: { min: 0 },
	legend: { position: 'nw' },
	grid: { clickable: true }
};

window.onload = function ()
{
	gInitColors();
	gInitMetrics();
	setTimeout(gTick, 0);
};

/*
 * Expand the base set of colors using simple variations.
 */
function gInitColors()
{
	var ii, jj, base, color, saturation;
	var saturations = [ 1.0, 0.5 ];

	for (ii = 0; ii < saturations.length; ii++) {
		for (jj = 0; jj < gBaseColors.length; jj++) {
			base = new gColor(gBaseColors[jj]);
			saturation = base.saturation() * saturations[ii];
			color = new gColor(
			    [ base.hue(), saturation, base.value() ], 'hsv');
			gColors.push(color);
		}
	}

	gMaxSeries = gColors.length - 1;
}

/*
 * Load the available metrics from the server to populate the UI.
 */
function gInitMetrics()
{
	var url = 'http://' + gServer + ':' + gPort + '/ca' +
	    gCustUri() + '/metrics';
	var request = new XMLHttpRequest();

	request.open('GET', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to load metric list');
			return;
		}

		gInitMetricsFini(JSON.parse(request.responseText));
	};
}

function gInitMetricsFini(metrics)
{
	var modname, statname, optname, module, stat;
	var elt, ii, option;

	for (modname in metrics) {
		module = metrics[modname];

		for (statname in module['stats']) {
			stat = module['stats'][statname];
			optname = module['label'] + ': ' + stat['label'];
			gMetrics.push({
				module: modname,
				modlabel: module['label'],
				stat: statname,
				statlabel: stat['label'],
				label: optname,
				fields: stat['fields'],
				type: stat['type']
			});
		}
	}

	elt = document.getElementById('gStatSelector');
	for (ii = 0; ii < gMetrics.length; ii++) {
		option = elt.appendChild(document.createElement('option'));
		option.value = ii;
		option.appendChild(document.createTextNode(gMetrics[ii].label));
	}

	if (gMetrics.length > 0) {
		gStatSelected();
		elt = document.getElementById('gStatAddButton');
		elt.disabled = false;
	}

	gInitInstrumentations();
}

/*
 * Now that we have the available metrics, retrieve and load graphs for
 * any preexisting instrumentations.
 */
function gInitInstrumentations()
{
	var url = 'http://' + gServer + ':' + gPort + '/ca' +
	    gCustUri() + '/instrumentations';
	var request = new XMLHttpRequest();

	request.open('GET', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to load instrumentation list');
			return;
		}

		gInitInstrumentationsFini(JSON.parse(request.responseText));
	};

}

function gInitInstrumentationsFini(instrumentations)
{
	var container, inst, metric, graph;
	var ii, jj;

	container = document.getElementById('gContainerDiv');

	for (ii = 0; ii < instrumentations.length; ii++) {
		inst = instrumentations[ii];

		for (jj = 0; jj < gMetrics.length; jj++) {
			metric = gMetrics[jj];
			if (metric.module == inst.modname &&
			    metric.stat == inst.statname)
				break;
		}

		if (jj == gMetrics.length)
			continue;

		graph = new gGraph({
			metric: metric,
			decomps: inst.decomp,
			customer_id: inst.customer_id,
			inst_id: inst.inst_id
		});

		container.appendChild(graph.getContainer());
		gGraphs[graph.getId()] = graph;
	}
}

/*
 * Invoked once/second to update all of our graphs.
 */
function gTick()
{
	for (var id in gGraphs)
		gGraphs[id].refresh();

	setTimeout(gTick, 1000);
}

/*
 * Returns the customer id of the currently active customer.  Currently, we just
 * store this in the browser URL's hash string.
 */
function gCustId()
{
	return (window.location.hash.substring(1));
}

/*
 * Given a customer id, return the customer-specific (scope) portion of URIs for
 * this customer's requests.  If the customer id is undefined, the global scope
 * is assumed.
 */
function gCustUri(custid)
{
	if (custid === undefined)
		custid = window.location.hash.substring(1);
	return (custid.length > 0 ? '/customers/' + custid : '');
}

/*
 * Identifies which metric and decomposition(s) are selected, creates the
 * corresponding instrumentation on the server, and adds a new graph to the UI.
 */
function gAddStat()
{
	var statsel, decompsel, decomp2sel;
	var statoption, decompoption, decomp2option;
	var container, metric, decomps, graph;

	statsel = document.getElementById('gStatSelector');
	statoption = statsel.options[statsel.selectedIndex];
	decompsel = document.getElementById('gDecompositionSelector');
	decompoption = decompsel.options[decompsel.selectedIndex];
	decomp2sel = document.getElementById('gDecompositionSelector2');
	decomp2option = decomp2sel.options[decomp2sel.selectedIndex];

	metric = gMetrics[statoption.value];
	decomps = [];

	if (decompoption.value !== '')
		decomps.push(decompoption.value);

	if (decomp2option.value !== '')
		decomps.push(decomp2option.value);

	graph = new gGraph({
		metric: metric,
		decomps: decomps,
		customer_id: gCustId() || undefined
	});

	container = document.getElementById('gContainerDiv');
	container.appendChild(graph.getContainer());
	graph.serverCreate(function (err, result) {
		if (err) {
			container.removeChild(graph.getContainer());
			alert(err);
			return;
		}

		gGraphs[graph.getId()] = graph;
	});
}

/*
 * Delete the instrumentation for this graph and remove the graph from the UI.
 */
function gRemoveStat(graph)
{
	var div = graph.getContainer();

	div.parentNode.removeChild(div);
	delete (gGraphs[graph.getId()]);

	graph.serverDelete(function (err) {
		if (err)
			alert(err);
	});
}

/*
 * Invoked when the user selects a particular module/stat so we can populate the
 * decomposition selectors with the appropriate options.
 */
function gStatSelected()
{
	var statsel, decompsel, metric, option;
	var field;

	decompsel = document.getElementById('gDecompositionSelector');
	decompsel.disabled = false;
	while (decompsel.options.length > 0)
		decompsel.remove(decompsel.options[0]);

	statsel = document.getElementById('gStatSelector');
	option = statsel.options[statsel.selectedIndex];
	metric = gMetrics[option.value];

	option = decompsel.appendChild(document.createElement('option'));
	option.value = '';
	option.appendChild(document.createTextNode('<none>'));

	for (field in metric.fields) {
		option = decompsel.appendChild(
		    document.createElement('option'));
		option.value = field;
		option.appendChild(document.createTextNode(
		    metric.fields[field].label));
	}

	decompsel.selectedIndex = 0;

	if (decompsel.options.length == 1)
		decompsel.disabled = true;

	gDecompSelected();
}

/*
 * Invoked when the user selects a particular decomposition so we can populate
 * the secondary decomposition selector.  We don't allow the user to decompose
 * by two fields with the same type.
 */
function gDecompSelected()
{
	var statsel, decompsel, decompsel2, metric;
	var statoption, firstoption, option;
	var field;

	decompsel = document.getElementById('gDecompositionSelector');
	firstoption = decompsel.options[decompsel.selectedIndex];

	decompsel2 = document.getElementById('gDecompositionSelector2');
	while (decompsel2.options.length > 0)
		decompsel2.remove(decompsel.options[0]);

	option = document.createElement('option');
	option.value = '';
	option.appendChild(document.createTextNode('<none>'));
	decompsel2.appendChild(option);

	statsel = document.getElementById('gStatSelector');
	statoption = statsel.options[statsel.selectedIndex];
	metric = gMetrics[statoption.value];

	for (field in metric.fields) {
		if (field == firstoption.value)
			continue;

		if (firstoption.value !== '' &&
		    metric.fields[field].type ==
		    metric.fields[firstoption.value].type)
			continue;

		option = document.createElement('option');
		option.value = field;
		option.appendChild(
		    document.createTextNode(metric.fields[field].label));
		decompsel2.appendChild(option);
	}

	decompsel2.selectedIndex = 0;

	if (firstoption.value === '' || decompsel2.options.length == 1)
		decompsel2.disabled = true;
	else
		decompsel2.disabled = false;
}

/*
 * The gGraph object represents a graph in the UI backed by a particular
 * instrumentation on the server.  The following configuration options MUST be
 * specified:
 *
 *	metric		identifies the module, stat, etc.  This should be one of
 *			the elements of gMetrics.
 *
 *	decomps		list of fields identifying the decomposition
 *
 * The following configuration options identifying the customer id (scope) and
 * instrumentation id MAY be specified:
 *
 *	customer_id	if undefined, the global scope is assumed
 *
 *	inst_id		if undefined, the stat is assumed not to exist yet
 */
function gGraph(conf)
{
	this.g_id = gGraph.gId++;
	this.g_metric = conf.metric;
	this.g_decomps = conf.decomps;
	this.g_custid = conf.customer_id;
	this.g_inst_id = conf.inst_id;

	this.g_title = conf.metric.modlabel + ': ' + conf.metric.statlabel;

	if (conf.decomps.length !== 0) {
		this.g_title += ' decomposed by ' +
		    conf.decomps.map(function (elt) {
			return (conf.metric.fields[elt].label);
		    }).join(' and ');
	}

	this.initDetails();
	this.initDom();
	this.initUri();
}

gGraph.gId = 0;

/*
 * Examines the selected metric and decomposition to determine the type and
 * subtype and various other fields required to build the DOM representation of
 * the graph and manage the underlying instrumentation state.  This method
 * initializes the following members:
 *
 *	g_type		'scalar' | 'vector'
 *			Used when processing raw data to determine what kind of
 *			data to expect for each raw datum.
 *
 *	g_subtype	'raw' | 'heatmap'
 *			Identifies the 'value' sub-URI to use to retrieve the
 *			value for this instrumentation.  Also controls what to
 *			do with the resulting value.
 *
 *	g_options	flot options to use for flot gaphs
 *	g_columns	columns to create in graph legend
 *
 * Additional subtype-specific fields are also initialized here.
 */
gGraph.prototype.initDetails = function ()
{
	var fieldname, discrete_decomp, ii;
	var metric = this.g_metric, decomps = this.g_decomps;

	this.g_body = 'module=' + metric.module + '&stat=' + metric.stat;

	if (decomps.length === 0) {
		this.g_type = 'scalar';
		this.g_subtype = 'raw';
		this.g_columns =  [ { sTitle: 'Selected value' } ];
		this.g_options = gScalarOptions;
	} else {
		this.g_type = 'vector';
		this.g_subtype = 'raw';
		this.g_options = gVectorOptions;

		this.g_columns = [];
		for (ii = 0; ii < decomps.length; ii++) {
			this.g_body += '&decomposition=' + decomps[ii];

			for (fieldname in metric.fields) {
				if (decomps[ii] != fieldname)
					continue;

				if (metric.fields[fieldname].type ==
				    'numeric') {
					this.g_subtype = 'heatmap';
					continue;
				}

				discrete_decomp = metric.fields[decomps[ii]];
			}
		}

		if (discrete_decomp) {
			this.g_columns.push({ sTitle: discrete_decomp.label });

			if (this.g_subtype != 'heatmap')
				this.g_columns.push({ sTitle: 'value' });
		} else {
			this.g_columns.push({ sTitle: 'value' });
		}
	}

	if (this.g_subtype == 'raw') {
		this.g_data = [];
		for (ii = 0; ii < gnDataPoints; ii++)
			this.g_data.push(null);
	} else {
		this.g_hues = [];
		this.g_selected = {};
		this.g_ncreated = 0;
		this.g_coloring = 'rank';
		this.g_weights = 'count';
		this.g_isolate = false;
	}
};

/*
 * Constructs the DOM representation of this graph, accessible thereafter using
 * the getContainer() accessor method.
 */
gGraph.prototype.initDom = function ()
{
	var graph = this;
	var div, elt, table, tr, td, legend, tbody;

	div = this.g_elt_container = document.createElement('div');
	div.className = 'gGraphContainer';

	div.appendChild(this.createToolbar(elt));

	table = div.appendChild(document.createElement('table'));
	tr = table.appendChild(document.createElement('tr'));
	td = tr.appendChild(document.createElement('td'));

	elt = this.g_elt_graph = td.appendChild(document.createElement('div'));
	elt.className = 'Graph';
	elt.id = 'graph' + this.g_id;
	elt.style.width = gPlotWidth + 'px';
	elt.style.height = gPlotHeight + 'px';

	td = tr.appendChild(document.createElement('td'));
	td.className = 'GraphLegend';
	legend = td.appendChild(document.createElement('table'));
	legend.appendChild(document.createElement('thead'));
	tbody = legend.appendChild(document.createElement('tbody'));
	legend.id = 'legend' + this.g_id;

	this.g_table = $(legend).dataTable({
		aaData: [],
		bFilter: false,
		bJQueryUI: true,
		bAutoWidth: true,
		sScrollY: '300px',
		bPaginate: false,
		bScrollInfinite: true,
		aoColumns: this.g_columns,
		fnRowCallback: function (node) {
			if (node.firstChild.tabIndex === 0)
				return (node);

			node.firstChild.tabIndex = 0;
			$(node.firstChild).keydown(function (event) {
				graph.heatmapKeyPressed(event);
			});

			return (node);
		}
	});

	$(tbody).click(function (event) {
	    graph.heatmapRowClicked(event); });
};

/*
 * Constructs the DOM representation for this graph's toolbar.
 */
gGraph.prototype.createToolbar = function ()
{
	var graph = this;
	var head, subdiv, button;

	head = document.createElement('h3');
	head.appendChild(document.createTextNode(this.g_title));

	subdiv = document.createElement('div');
	subdiv.className = 'gToolbar ui-widget-header ui-corner-all';

	button = subdiv.appendChild(document.createElement('button'));
	button.appendChild(document.createTextNode('delete'));
	$(button).button({
		text: false,
		label: 'delete',
		icons: { primary: 'ui-icon-trash' }
	}).click(function () { gRemoveStat(graph); });

	if (this.g_subtype != 'heatmap') {
		subdiv.appendChild(head);
		return (subdiv);
	}

	subdiv.appendChild(this.createButton('isolate', [
	    { label: 'isolate', value: true },
	    { label: 'integrate', value: false }
	]));

	subdiv.appendChild(this.createButton('weights', [
	    { label: 'weight', value: 'weight' },
	    { label: 'count', value: 'count' }
	]));

	subdiv.appendChild(this.createButton('coloring', [
	    { label: 'linear', value: 'linear' },
	    { label: 'rank', value: 'rank' }
	]));

	subdiv.appendChild(head);
	return (subdiv);
};

/*
 * Creates a button that toggles the given "field", whose state is stored in a
 * member of this graph called 'g_$field'.  Each of exactly two choices must
 * specify a label and a value.
 */
gGraph.prototype.createButton = function (field, choices)
{
	var graph = this;
	var button = document.createElement('button');
	button.appendChild(document.createTextNode(choices[0]['label']));
	$(button).button({
		label: choices[0]['label']
	}).click(function () { graph.toggle(field, choices, button); });
	return (button);
};

/*
 * Invoked when a toolbar toggle button has been clicked to update the graph's
 * value for this property and update the button's state.
 */
gGraph.prototype.toggle = function (field, choices, button)
{
	var options = {};

	if ($(button).text() == choices[0]['label']) {
		options.label = choices[1]['label'];
		this['g_' + field] = choices[0]['value'];
	} else {
		options.label = choices[0]['label'];
		this['g_' + field] = choices[1]['value'];
	}

	$(button).button('option', options);
	this.refresh();
};

/*
 * Initializes members representing several useful URIs for this graph.
 */
gGraph.prototype.initUri = function ()
{
	this.g_uri_base = '/ca' + gCustUri(this.g_custid) +
	    '/instrumentations';

	if (this.g_inst_id !== undefined)
		this.g_uri_base += '/' + this.g_inst_id;

	this.g_uri_cfg = 'http://' + gServer + ':' + gPort +
	    this.g_uri_base;
	this.g_uri_val = 'http://' + gServer + ':' + gPort +
	    this.g_uri_base + '/value/' + this.g_subtype;
};

gGraph.prototype.getContainer = function () { return (this.g_elt_container); };
gGraph.prototype.getId = function () { return (this.g_id); };

/*
 * Creates the underlying instrumentation on the server for this graph.  If the
 * instrumentation already exists, the behavior is undefined.  The callback is
 * invoked with two arguments: a non-empty error string if an error occurred, or
 * the object returned by the server for this call.
 */
gGraph.prototype.serverCreate = function (callback)
{
	var graph = this;
	var request = new XMLHttpRequest();

	request.open('POST', this.g_uri_cfg, true);
	request.setRequestHeader('Content-Type',
	    'application/x-www-form-urlencoded');
	request.send(this.g_body);
	request.onreadystatechange = function () {
		var value, errmsg;

		if (request.readyState != 4)
			return;

		if (request.status != 201) {
			try {
				/*
				 * In Firefox, accessing this field can generate
				 * an exception.
				 */
				errmsg = request.statusText;
			} catch (ex) {
				errmsg = '<unknown error: ' +
				    request.status + '>';
			}

			callback('failed to create stat: ' + errmsg);
			return;
		}

		value = JSON.parse(request.responseText);
		graph.g_inst_id = value.id;
		graph.initUri();

		setTimeout(function () {
			callback(null, value);
		}, 1000);
	};
};

/*
 * Deletes the underlying instrumentation on the server.  The callback is
 * invoked with a non-empty error string if any error occurs.
 */
gGraph.prototype.serverDelete = function (callback)
{
	var request;

	request = new XMLHttpRequest();
	request.open('DELETE', this.g_uri_cfg, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200)
			callback('failed to delete stat: ' +
			    request.statusText);
		else
			callback();
	};
};

/*
 * Returns the graph-state-specific parameters used when fetching the latest
 * value from the server for this graph's instrumentation.
 */
gGraph.prototype.uriParams = function ()
{
	var url, value;

	if (this.g_subtype != 'heatmap')
		return ('');

	url = '?width=' + gPlotWidth + '&';
	url += 'height=' + gPlotHeight + '&';
	url += 'duration=' + gnDataPoints + '&';
	url += 'nbuckets=' + gnBuckets + '&';
	url += 'coloring=' + this.g_coloring + '&';
	url += 'weights=' + this.g_weights;

	if (this.g_isolate)
		url += '&isolate=true';
	else
		url += '&hues=21';

	for (value in this.g_selected) {
		url += '&selected=' + value;
		url += '&hues=' + this.g_selected[value];
	}

	return (url);
};

/*
 * Kicks off an asynchronous update for this graph, retrieving the latest value
 * and updating the graph.
 */
gGraph.prototype.refresh = function ()
{
	var graph = this;
	var request, url;

	url = this.g_uri_val + this.uriParams();
	request = new XMLHttpRequest();
	request.open('GET', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		var value = JSON.parse(request.responseText);

		if (graph.g_subtype == 'heatmap')
			graph.updateHeatmap(value);
		else
			graph.updateRaw(value);
	};
};

/*
 * Given the value of a heatmap instrumentation, updates the visualization.
 */
gGraph.prototype.updateHeatmap = function (value)
{
	var div, img, present, key;

	div = this.g_elt_graph;
	img = div.childNodes[0];

	if (!img)
		img = div.appendChild(document.createElement('img'));

	img.src = 'data:image/png;base64,' + value.image;

	present = [];
	for (key in value.present)
		present.push(key);
	present.sort();

	this.updateTable(present.map(function (elt) {
		return ({ key: elt, val: [ elt ] });
	}));
};

/*
 * Given the value of a raw instrumentation, updates the flot visualization.
 */
gGraph.prototype.updateRaw = function (value)
{
	var graph, datum, data;

	/*
	 * XXX we could have received this data out of order.  It's
	 * probably not worth fixing for this demo.
	 */
	graph = this;
	datum = [ new Date(value.when * 1000), value.value ];
	this.g_data.shift();
	this.g_data.push(datum);
	data = this.rawRecompute();
	this.g_plot = $.plot(this.g_elt_graph, data, this.g_options);

	if (this.g_highlighted)
		this.updateHighlighting(this.g_highlighted - 1);

	if (!this.g_bound) {
		$(this.g_elt_graph).bind('plotclick',
		    function (e, p, i) { graph.clicked(p); });
		this.g_bound = true;
	}
};

/*
 * For raw data plots (flot plots), recompute the complete set of data that we
 * need to hand to flot in order to redraw the graph.
 */
gGraph.prototype.rawRecompute = function ()
{
	var series, points, datum, row;
	var keytots, keys, colors;
	var ii, jj, key, showother, othertot;

	if (this.g_type == 'scalar')
		return ([ this.rawRecomputeOne(this.g_title, this.g_data) ]);

	/*
	 * For vector-valued metrics, we essentially transpose the data: while
	 * our data is of the form (time, vector of scalars), flot wants an
	 * array of series, each of which is an array of (time, scalar) tuples.
	 * Each series is plotted separately in its own color.  Importantly, we
	 * don't want the colors to jump around as new series come and go, so we
	 * allocate colors ourselves to make sure they stay consistent over
	 * time.  We also don't want the legend to expand too large, so we only
	 * show the top N keys.
	 *
	 * Here's the process:
	 *
	 *   o Iterate over all keys at all data points and create a new mapping
	 *     from key name -> total over this period.
	 *
	 *   o Sort these key-value pairs by their totals.  Remove entries
	 *     not in the top N (gMaxSeries).
	 *
	 *   o Iterate over assigned colors.  If any colors are assigned to keys
	 *     not in the top N, remove the assignment.
	 *
	 *   o Construct the series: there will be at most N + 1 of them.
	 *
	 *	o For each of the top N keys, create a series from the values of
	 *	  each key at each data point we have.  Check whether we've
	 *	  assigned a color to this key: if so, use it.  Otherwise,
	 *	  allocate a new color.
	 *
	 *	o Create a series whose value at each point is the sum of each
	 *	  of the keys at this point that are NOT in the top N.  We can
	 *	  use the same color for all of these.
	 */
	keytots = {};
	for (ii = 0; ii < gnDataPoints; ii++) {
		if (this.g_data[ii] === null)
			continue;

		for (key in this.g_data[ii][1]) {
			if (!(key in keytots))
				keytots[key] = 0;

			keytots[key] += this.g_data[ii][1][key];
		}
	}

	keys = [];
	for (key in keytots)
		keys.push(key);

	keys.sort(function (k1, k2) { return (keytots[k2] - keytots[k1]); });
	for (ii = gMaxSeries; ii < keys.length; ii++)
		delete (keytots[keys[ii]]);
	keys = keys.slice(0, gMaxSeries);

	if (!this.g_colorsbykey)
		this.g_colorsbykey = {};

	colors = {};

	for (key in this.g_colorsbykey) {
		if (!(key in keytots)) {
			delete (this.g_colorsbykey[key]);
			continue;
		}

		colors[this.g_colorsbykey[key]] = key;
	}

	for (key in keytots) {
		if (key in this.g_colorsbykey)
			continue;

		for (ii = 0; gColors[ii] in colors; ii++) {
			if (ii > gColors.length - 1)
				throw ('error: too few colors');
		}

		colors[gColors[ii]] = key;
		this.g_colorsbykey[key] = gColors[ii];
	}

	series = [];
	for (ii = 0; ii < gColors.length && ii < keys.length; ii++) {
		key = colors[gColors[ii]];
		points = [];

		for (jj = 0; jj < gnDataPoints; jj++) {
			datum = this.g_data[jj];

			if (datum === null) {
				points.push(null);
				continue;
			}

			points.push([ datum[0],
			    key in datum[1] ? datum[1][key] : 0 ]);
		}

		row = this.rawRecomputeOne(key, points);
		row.stack = true;
		row.color = gColors[ii].css();
		series.push(row);
	}

	points = [];
	showother = false;
	for (ii = 0; ii < gnDataPoints; ii++) {
		datum = this.g_data[ii];

		if (datum === null) {
			points.push(null);
			continue;
		}

		othertot = 0;
		for (key in datum[1]) {
			if (key in keytots)
				continue;

			showother = true;
			othertot += datum[1][key];
		}

		points.push([ datum[0], othertot ]);
	}

	if (showother) {
		row = this.rawRecomputeOne('&lt;other&gt;', points);
		row.stack = true;
		row.color = gColors[gColors.length - 1].css();
		series.push(row);
	}

	return (series);
};

/*
 * See rawRecomputeData -- this recomputes a single row.
 */
gGraph.prototype.rawRecomputeOne = function (label, rawdata)
{
	var points = [];
	var ii;

	/*
	 * Iterate backwards to back-fill NULL values with zero.  This should
	 * really be filled with some other pattern to indicate "no data".
	 */
	for (ii = gnDataPoints - 1; ii >= 0; ii--) {
		if (rawdata[ii] !== null || ii == gnDataPoints - 1) {
			points[ii] = rawdata[ii];
			continue;
		}

		points[ii] =
		    [ new Date(points[ii + 1][0].getTime() - 1000), undefined ];
	}

	return ({ label: label, data: points });
};

/*
 * Invoked when a flot plot is clicked.  Highlights the nearest data point and
 * updates the graph's side-legend with additional details about that point.
 */
gGraph.prototype.clicked = function (pos)
{
	var graph = this;
	var when = Math.round(pos.x / 1000) * 1000;
	var ii, jj, key, keys, legend;

	for (ii = 0; ii < this.g_data.length; ii++) {
		if (this.g_data[ii] !== null &&
		    this.g_data[ii][0].getTime() == when)
			break;
	}

	if (ii == this.g_data.length)
		return;

	if (this.g_type == 'scalar') {
		legend = [
		    { key: this.g_data[ii][1], val: this.g_data[ii][1] }
		];
	} else {
		keys = [];
		for (key in this.g_data[ii][1])
			keys.push(key);
		keys.sort(function (k1, k2) {
			return (graph.g_data[ii][1][k2] -
			    graph.g_data[ii][1][k1]);
		});

		legend = [];
		for (jj = 0; jj < keys.length; jj++) {
			legend.push({ key: keys[jj],
			    val: [ keys[jj], this.g_data[ii][1][keys[jj]] ] });
		}
	}

	this.updateTable(legend, true);
	this.updateHighlighting(ii);
};

/*
 * Highlights the specified point on a flot-based plot.
 */
gGraph.prototype.updateHighlighting = function (yy)
{
	var ii, data;

	this.g_highlighted = yy;
	this.g_plot.unhighlight();
	data = this.g_plot.getData();

	for (ii = 0; ii < data.length; ii++) {
		if (data[ii].data[yy][1] !== 0)
			this.g_plot.highlight(ii, yy);
	}
};

/*
 * Populate the specified graph's side legend with additional details.
 * 'entries' is an array of objects with the following members:
 *
 *	value	Value to add to side legend (jquery data table)
 *
 *	key	Identifier.  An entry's value will only be added to the legend
 *		when no other entry with the same key has ever been added.
 */
gGraph.prototype.updateTable = function (entries, clear)
{
	var focused = document.activeElement;
	var rows, ii;

	if (clear)
		this.g_table.fnClearTable();

	if (clear || !this.g_legend_rows)
		this.g_legend_rows = {};

	rows = this.g_legend_rows;

	for (ii = 0; ii < entries.length; ii++) {
		if (!(entries[ii].key in rows))
			rows[entries[ii].key] =
			    this.g_table.fnAddData([ entries[ii].val ]);
	}

	focused.focus();
};

gGraph.prototype.allocateHue = function ()
{
	var which;

	if (this.g_hues.length > 0)
		return (this.g_hues.pop());

	which = this.g_ncreated++ % gColors.length;

	return (gColors[which].hue());
};

gGraph.prototype.deallocateHue = function (hue)
{
	this.g_hues.push(hue);
};

/*
 * Invoked when the user clicks a row in the table.
 */
gGraph.prototype.heatmapRowClicked = function (event)
{
	return (this.heatmapRowSelect(event.target, event.shiftKey));
};

gGraph.prototype.heatmapRowSelect = function (target, shift)
{
	var table = this.g_table;
	var hue, value, already;

	value = table.fnGetData(target.parentNode)[0];
	already = value in this.g_selected;

	if (!shift) {
		$(table.fnSettings().aoData).each(function () {
			$(this.nTr).removeClass('row_selected');
			this.nTr.style.backgroundColor = '#ffffff';
		});

		this.g_selected = {};
		this.g_ncreated = 0;
		this.g_hues = [];
	}

	if (!already) {
		$(target.parentNode).addClass('row_selected');
		hue = this.allocateHue();
		this.g_selected[value] = hue;
		target.parentNode.style.backgroundColor =
		    new gColor([ hue, 0.9, 0.95 ], 'hsv').css();
	} else if (shift) {
		target.parentNode.style.backgroundColor = '#ffffff';
		this.deallocateHue(this.g_selected[value]);
		$(target.parentNode).removeClass('row_selected');
		delete (this.g_selected[value]);
	}

	target.focus();
	this.refresh();
};

/*
 * Invoked when the user presses a key on a row.
 */
gGraph.prototype.heatmapKeyPressed = function (event)
{
	var sibling;

	switch (event.which) {
	case 38: /* up arrow */
		/* jsl:fall-thru */
	case 75: /* 'k' key */
		sibling = event.target.parentNode.previousSibling;
		break;
	case 40: /* down arrow */
		/* jsl:fall-thru */
	case 74: /* 'j' key */
		sibling = event.target.parentNode.nextSibling;
		break;
	}

	if (!sibling)
		return;

	this.heatmapRowSelect(sibling.firstChild, event.shiftKey);
};

/*
 * Represents a color.  You'd think that a library for this would already exist
 * -- and you'd be right.  There's a jQuery library for dealing with colors that
 * can convert between HSV and RGB and parse CSS color names.  Unfortunately, it
 * uses the same jQuery field ($.color) as a different implementation with an
 * incompatible interface that flot bundles and uses, so we can't use it here.
 * Thanks for nothing, client-side Javascript, jQuery, and flot, whose namespace
 * decisions have brought us here.
 *
 * The HSV <-> RGB conversion routines are ported from the implementations by
 * Eugene Vishnevsky:
 *
 *   http://www.cs.rit.edu/~ncs/color/t_convert.html
 */
function gColor()
{
	var rgb, space;

	if (arguments.length === 1) {
		this.css = arguments[0];
		rgb = $.color.parse(this.css);
		this.rgb = [ rgb.r, rgb.g, rgb.b ];
		return;
	}

	switch (arguments[1]) {
	case 'rgb':
	case 'hsv':
		space = arguments[1];
		break;
	default:
		throw ('unsupported color space: ' + arguments[1]);
	}

	this[space] = arguments[0];
}

gColor.prototype.hue = function ()
{
	if (!this.hsv)
		this.rgbToHsv();

	return (this.hsv[0]);
};

gColor.prototype.saturation = function ()
{
	if (!this.hsv)
		this.rgbToHsv();

	return (this.hsv[1]);
};

gColor.prototype.value = function ()
{
	if (!this.hsv)
		this.rgbToHsv();

	return (this.hsv[2]);
};

gColor.prototype.rgbToHsv = function ()
{
	var r = this.rgb[0], g = this.rgb[1], b = this.rgb[2];
	var min, max, delta;
	var h, s, v;

	r /= 255;
	g /= 255;
	b /= 255;

	min = Math.min(r, g, b);
	max = Math.max(r, g, b);
	v = max;

	delta = max - min;

	if (max === 0) {
		s = 0;
		h = 0;
	} else {
		s = delta / max;

		if (r == max)
			h = (g - b) / delta;
		else if (g == max)
			h = 2 + (b - r) / delta;
		else
			h = 4 + (r - g) / delta;

		h *= 60;

		if (h < 0)
			h += 360;
	}

	this.hsv = [ h, s, v ];
};

gColor.prototype.hsvToRgb = function ()
{
	/*
	 * Convert from HSV to RGB.  Ported from the Java implementation by
	 * Eugene Vishnevsky:
	 *
	 *   http://www.cs.rit.edu/~ncs/color/t_convert.html
	 */
	var h = this.hsv[0], s = this.hsv[1], v = this.hsv[2];
	var r, g, b;
	var i;
	var f, p, q, t;

	if (s === 0) {
		/*
		 * A saturation of 0.0 is achromatic (grey).
		 */
		r = g = b = v;

		this.rgb = [ Math.round(r * 255), Math.round(g * 255),
		    Math.round(b * 255) ];
		return;
	}

	h /= 60; // sector 0 to 5

	i = Math.floor(h);
	f = h - i; // fractional part of h
	p = v * (1 - s);
	q = v * (1 - s * f);
	t = v * (1 - s * (1 - f));

	switch (i) {
		case 0:
			r = v;
			g = t;
			b = p;
			break;

		case 1:
			r = q;
			g = v;
			b = p;
			break;

		case 2:
			r = p;
			g = v;
			b = t;
			break;

		case 3:
			r = p;
			g = q;
			b = v;
			break;

		case 4:
			r = t;
			g = p;
			b = v;
			break;

		default: // case 5:
			r = v;
			g = p;
			b = q;
			break;
	}

	this.rgb = [ Math.round(r * 255),
	    Math.round(g * 255), Math.round(b * 255)];
};

gColor.prototype.css = function ()
{
	if (!this.rgb)
		this.hsvToRgb();

	return ('rgb(' + this.rgb.join(', ') + ')');
};

gColor.prototype.toString = function ()
{
	return (this.css());
};
