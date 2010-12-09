/*
 * caflot.js: flot-based visualization of CA metrics for demo
 */

var gServer = window.location.hostname;
var gBaseUrlValue = 'http://' + gServer + ':23182/metrics/instrumentation/';
var gBaseUrlCreate = 'http://' + gServer + ':23181/metrics/instrumentation';
var gBaseUrlMetrics = 'http://' + gServer + ':23181/metrics';
var gBaseColors = [ '#edc240', '#afd8f8', '#cb4b4b', '#4da74d', '#9440ed' ];
var gColors = [];
var gMaxSeries;

var gPlotWidth = 600;		/* pixels */
var gPlotHeight = 300;		/* pixels */
var gnBuckets = 50;		/* buckets */
var gnDataPoints = 30;		/* number of data points to show */
var gMetrics = [];		/* all available metrics */
var gGraphs = {};		/* currently active graphs */
var gId = 0;			/* next available graph id */

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
	gInitMetrics();
	gInitColors();
	setTimeout(gTick, 0);
};

/*
 * Load the available metrics from the server to populate the UI.
 */
function gInitMetrics()
{
	var request;

	request = new XMLHttpRequest();
	request.open('GET', gUrlMetrics(), true);
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

/*
 * Finish loading the available metrics from the server.
 */
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
				stat: statname,
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
}

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
 * Invoked once/second to update all of our graphs.
 */
function gTick()
{
	var id;

	for (id in gGraphs)
		gRetrieveData(id);

	setTimeout(gTick, 1000);
}

/*
 * Retrieve the latest value for the specified instrumentation.
 */
function gRetrieveData(id)
{
	var graph = gGraphs[id];
	var callback = graph.fillcb;
	var url = gUrlValue(id);
	var body = null;
	var request, value;

	request = new XMLHttpRequest();

	if (graph.subtype == 'heatmap') {
		url += '?width=' + gPlotWidth + '&';
		url += 'height=' + gPlotHeight + '&';
		url += 'duration=' + gnDataPoints + '&';
		url += 'nbuckets=' + gnBuckets + '&';
		url += 'coloring=' + graph.coloring + '&';
		url += 'weights=' + graph.weights;

		if (graph.isolate)
			url += '&isolate=true';
		else
			url += '&hues=21';

		for (value in graph.selected) {
			url += '&selected=' + value;
			url += '&hues=' + graph.selected[value];
		}
	}

	request.open('GET', url, true);
	request.send(body);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		callback(JSON.parse(request.responseText));
	};
}

/*
 * Given an instrumentation id, returns a function that given a new datum,
 * updates and redraws the instrumentation's flot-based (non-heatmap) plot.
 */
function gFillData(id)
{
	return (function (value) {
		var graph, datum, data;

		/*
		 * XXX we could have received this data out of order.  It's
		 * probably not worth fixing for this demo.
		 */
		if (!(id in gGraphs))
			return;

		datum = [ new Date(value.when * 1000), value.value ];
		graph = gGraphs[id];
		graph.data.shift();
		graph.data.push(datum);
		data = gRecomputeData(id);
		graph.plot = $.plot(graph.graph, data, graph.options);

		if (graph.highlighted)
			gUpdateHighlighting(graph, graph.highlighted - 1);

		if (!graph.bound) {
			$(graph.graph).bind('plotclick',
			    function (e, p, i) { gPlotClicked(id, p); });
			graph.bound = true;
		}
	});
}

/*
 * Given an instrumentation id, returns a function that given a new heatmap
 * datum (including a new PNG), updates and redraws the instrumentation's plot.
 */
function gFillHeatmap(id)
{
	return (function (value) {
		var div, img, present, key;

		if (!(id in gGraphs))
			return;

		div = gGraphs[id].graph;
		img = div.childNodes[0];

		if (!img)
			img = div.appendChild(document.createElement('img'));

		img.src = 'data:image/png;base64,' + value.image;

		present = [];
		for (key in value.present)
			present.push(key);
		present.sort();

		gPlotShow(id, present.map(function (elt) {
			return ({ key: elt, val: [ elt ] });
		}));
	});
}

/*
 * Invoked when a flot plot is clicked.  Highlights the nearest data point and
 * updates the graph's side-legend with additional details about that point.
 */
function gPlotClicked(id, pos)
{
	var graph = gGraphs[id];
	var when = Math.round(pos.x / 1000) * 1000;
	var ii, jj, key, keys, legend;

	for (ii = 0; ii < graph.data.length; ii++) {
		if (graph.data[ii] !== null &&
		    graph.data[ii][0].getTime() == when)
			break;
	}

	if (ii == graph.data.length)
		return;

	if (graph.type == 'scalar') {
		legend = [ { key: graph.data[ii][1], val: graph.data[ii][1] } ];
	} else {
		keys = [];
		for (key in graph.data[ii][1])
			keys.push(key);
		keys.sort(function (k1, k2) {
			return (graph.data[ii][1][k2] - graph.data[ii][1][k1]);
		});

		legend = [];
		for (jj = 0; jj < keys.length; jj++) {
			legend.push({ key: keys[jj],
			    val: [ keys[jj], graph.data[ii][1][keys[jj]] ] });
		}
	}

	gPlotShow(id, legend, true);
	gUpdateHighlighting(graph, ii);
}

/*
 * Highlights the specified point on a flot-based plot.
 */
function gUpdateHighlighting(graph, yy)
{
	var ii, data;

	graph.highlighted = yy;
	graph.plot.unhighlight();
	data = graph.plot.getData();

	for (ii = 0; ii < data.length; ii++) {
		if (data[ii].data[yy][1] !== 0)
			graph.plot.highlight(ii, yy);
	}
}

/*
 * Populate the specified graph's side legend with additional details.
 * 'entries' is an array of objects with the following members:
 *
 *	value	Value to add to side legend (jquery data table)
 *
 *	key	Identifier.  An entry's value will only be added to the legend
 *		when no other entry with the same key has ever been added.
 */
function gPlotShow(id, entries, clear)
{
	var graph = gGraphs[id];
	var rows, ii;
	var focused = document.activeElement;

	if (clear)
		graph.legend.fnClearTable();

	if (clear || !graph.legend_rows)
		graph.legend_rows = {};

	rows = graph.legend_rows;

	for (ii = 0; ii < entries.length; ii++) {
		if (!(entries[ii].key in rows))
			rows[entries[ii].key] =
			    graph.legend.fnAddData([ entries[ii].val ]);
	}

	focused.focus();
}

/*
 * Given a graph id for a flot-based plot, recompute the complete set of data
 * that we need to hand to flot in order to redraw the graph.
 */
function gRecomputeData(id)
{
	var graph = gGraphs[id];
	var series, points, datum, row;
	var keytots, keys, colors;
	var ii, jj, key, showother, othertot;

	if (graph.type == 'scalar')
		return ([ gRecomputeOne(graph.label, graph.data) ]);

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
		if (graph.data[ii] === null)
			continue;

		for (key in graph.data[ii][1]) {
			if (!(key in keytots))
				keytots[key] = 0;

			keytots[key] += graph.data[ii][1][key];
		}
	}

	keys = [];
	for (key in keytots)
		keys.push(key);

	keys.sort(function (k1, k2) { return (keytots[k2] - keytots[k1]); });
	for (ii = gMaxSeries; ii < keys.length; ii++)
		delete (keytots[keys[ii]]);
	keys = keys.slice(0, gMaxSeries);

	if (!graph.colorsbykey)
		graph.colorsbykey = {};

	colors = {};

	for (key in graph.colorsbykey) {
		if (!(key in keytots)) {
			delete (graph.colorsbykey[key]);
			continue;
		}

		colors[graph.colorsbykey[key]] = key;
	}

	for (key in keytots) {
		if (key in graph.colorsbykey)
			continue;

		for (ii = 0; gColors[ii] in colors; ii++) {
			if (ii > gColors.length - 1)
				throw ('error: too few colors');
		}

		colors[gColors[ii]] = key;
		graph.colorsbykey[key] = gColors[ii];
	}

	series = [];
	for (ii = 0; ii < gColors.length && ii < keys.length; ii++) {
		key = colors[gColors[ii]];
		points = [];

		for (jj = 0; jj < gnDataPoints; jj++) {
			datum = graph.data[jj];

			if (datum === null) {
				points.push(null);
				continue;
			}

			points.push([ datum[0],
			    key in datum[1] ? datum[1][key] : 0 ]);
		}

		row = gRecomputeOne(key, points);
		row.stack = true;
		row.color = gColors[ii].css();
		series.push(row);
	}


	points = [];
	showother = false;
	for (ii = 0; ii < gnDataPoints; ii++) {
		datum = graph.data[ii];

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
		row = gRecomputeOne('&lt;other&gt;', points);
		row.stack = true;
		row.color = gColors[gColors.length - 1].css();
		series.push(row);
	}

	return (series);
}

/*
 * See gRecomputeData -- this recomputes a single row.
 */
function gRecomputeOne(label, rawdata)
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
}

/*
 * Returns the URL for getting the value of the specified instrumentation.
 */
function gUrlValue(id)
{
	var graph = gGraphs[id];
	var instid = graph.inst_id;

	return (gBaseUrlValue + instid + '/value/' + graph.subtype);
}

/*
 * Returns the URL for creating a new instrumentation.
 */
function gUrlCreate()
{
	return (gBaseUrlCreate);
}

/*
 * Returns the URL for deleting the specified instrumentation.
 */
function gUrlDelete(id)
{
	return (gBaseUrlCreate + '/' + id);
}

/*
 * Returns the URL for listing available metrics.
 */
function gUrlMetrics()
{
	return (gBaseUrlMetrics);
}

/*
 * Creates the toolbar for a new graph.
 */
function gCreateToolbar(div, subtype, id, elt)
{
	var subdiv, button;

	subdiv = document.createElement('div');
	subdiv.className = 'gToolbar ui-widget-header ui-corner-all';

	button = subdiv.appendChild(document.createElement('button'));
	button.appendChild(document.createTextNode('delete'));
	$(button).button({
		text: false,
		label: 'delete',
		icons: { primary: 'ui-icon-trash' }
	}).click(function () { gRemoveStat(id, div); });

	if (subtype != 'heatmap') {
		subdiv.appendChild(elt);
		return (subdiv);
	}

	subdiv.appendChild(gCreateButton(id, 'isolate', [
	    { label: 'isolate', value: true },
	    { label: 'integrate', value: false }
	]));

	subdiv.appendChild(gCreateButton(id, 'weights', [
	    { label: 'weight', value: 'weight' },
	    { label: 'count', value: 'count' }
	]));

	subdiv.appendChild(gCreateButton(id, 'coloring', [
	    { label: 'linear', value: 'linear' },
	    { label: 'rank', value: 'rank' }
	]));

	subdiv.appendChild(elt);
	return (subdiv);
}

function gCreateButton(id, field, choices)
{
	var button = document.createElement('button');
	button.appendChild(document.createTextNode(choices[0]['label']));
	$(button).button({
		label: choices[0]['label']
	}).click(function () { gToggle(button, field, choices, id); });
	return (button);
}

/*
 * Invoked when the user toggles the "isolate" property for this graph.
 */
function gToggle(button, field, choices, id)
{
	var options = {};
	var graph = gGraphs[id];

	if ($(button).text() == choices[0]['label']) {
		options.label = choices[1]['label'];
		graph[field] = choices[0]['value'];
	} else {
		options.label = choices[0]['label'];
		graph[field] = choices[1]['value'];
	}

	$(button).button('option', options);
	gRetrieveData(id);
}

function gAllocateHue(graph)
{
	var which;

	if (graph.hues.length > 0)
		return (graph.hues.pop());

	which = graph.ncreated++ % gColors.length;

	return (gColors[which].hue());
}

function gDeallocateHue(graph, hue)
{
	graph.hues.push(hue);
}

function gHeatmapRowSelect(id, target, shift)
{
	var graph = gGraphs[id];
	var table = graph.legend;
	var hue, value, already;

	value = table.fnGetData(target.parentNode)[0];
	already = value in graph.selected;

	if (!shift) {
		$(table.fnSettings().aoData).each(function () {
			$(this.nTr).removeClass('row_selected');
			this.nTr.style.backgroundColor = '#ffffff';
		});

		graph.selected = {};
		graph.ncreated = 0;
		graph.hues = [];
	}

	if (!already) {
		$(target.parentNode).addClass('row_selected');
		hue = gAllocateHue(graph);
		graph.selected[value] = hue;
		target.parentNode.style.backgroundColor =
		    new gColor([ hue, 0.9, 0.95 ], 'hsv').css();
	} else if (shift) {
		target.parentNode.style.backgroundColor = '#ffffff';
		gDeallocateHue(graph, graph.selected[value]);
		$(target.parentNode).removeClass('row_selected');
		delete (graph.selected[value]);
	}

	target.focus();
	gRetrieveData(id);
}

/*
 * Invoked when the user clicks a row in the table.
 */
function gHeatmapRowClicked(id, event)
{
	return (gHeatmapRowSelect(id, event.target, event.shiftKey));
}

/*
 * Invoked when the user presses a key on a row.
 */
function gHeatmapKeyPressed(id, event)
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

	gHeatmapRowSelect(id, sibling.firstChild, event.shiftKey);
}

/*
 * Instruments a new metric as specified by the UI fields.
 */
function gAddStat()
{
	var statsel, decompsel, decomp2sel;
	var statoption, decompoption, decomp2option;
	var metric, data, type, decomps, discrete_decomp;
	var id, ii, body, request, subtype, fieldname, fillcb;
	var container, div, title, elt;
	var table, tr, td, columns, legend, tbody;

	/*
	 * Identify which metric and decomposition(s) are selected.
	 */
	statsel = document.getElementById('gStatSelector');
	statoption = statsel.options[statsel.selectedIndex];
	decompsel = document.getElementById('gDecompositionSelector');
	decompoption = decompsel.options[decompsel.selectedIndex];
	decomp2sel = document.getElementById('gDecompositionSelector2');
	decomp2option = decomp2sel.options[decomp2sel.selectedIndex];

	metric = gMetrics[statoption.value];
	decomps = [];

	if (decompoption.value !== '')
		decomps.push(decompoption);

	if (decomp2option.value !== '')
		decomps.push(decomp2option);

	/*
	 * Based on the selected decompositions, generate the title for the
	 * graph, the actual HTTP request to create the instrumentation, and
	 * other fields used later to update the graphs.
	 */
	id = gId++;
	title = statoption.text;
	body = 'module=' + metric.module + '&stat=' + metric.stat;

	if (decomps.length === 0) {
		type = 'scalar';
		subtype = 'raw';
		columns =  [ { sTitle: 'Selected value' } ];
		fillcb = gFillData;
	} else {
		type = 'vector';
		subtype = 'raw';
		fillcb = gFillData;

		title += ' decomposed by ' + decomps.map(
		    function (opt) { return (opt.text); }).join(' and ');

		columns = [];
		for (ii = 0; ii < decomps.length; ii++) {
			body += '&decomposition=' + decomps[ii].value;

			for (fieldname in metric.fields) {
				if (decomps[ii].value != fieldname)
					continue;

				if (metric.fields[fieldname].type == 'linear') {
					subtype = 'heatmap';
					fillcb = gFillHeatmap;
					continue;
				}

				discrete_decomp = decomps[ii].text;
			}
		}

		if (discrete_decomp) {
			columns.push({ sTitle: discrete_decomp });

			if (subtype != 'heatmap')
				columns.push({ sTitle: 'value' });
		} else {
			columns.push({ sTitle: 'value' });
		}
	}

	/*
	 * Generate the skeleton DOM hierarchy for this graph.
	 */
	container = document.getElementById('gContainerDiv');
	div = container.appendChild(document.createElement('div'));
	div.className = 'gGraphContainer';

	elt = document.createElement('h3');
	elt.appendChild(document.createTextNode(title));
	elt.title = body;

	div.appendChild(gCreateToolbar(div, subtype, id, elt));

	table = div.appendChild(document.createElement('table'));
	tr = table.appendChild(document.createElement('tr'));
	td = tr.appendChild(document.createElement('td'));

	elt = td.appendChild(document.createElement('div'));
	elt.className = 'Graph';
	elt.id = 'graph' + id;
	elt.style.width = gPlotWidth + 'px';
	elt.style.height = gPlotHeight + 'px';

	td = tr.appendChild(document.createElement('td'));
	td.className = 'GraphLegend';
	legend = td.appendChild(document.createElement('table'));
	legend.appendChild(document.createElement('thead'));
	tbody = legend.appendChild(document.createElement('tbody'));
	legend.id = 'legend' + id;
	legend = $('#legend' + id).dataTable({
		aaData: [],
		bFilter: false,
		bJQueryUI: true,
		bAutoWidth: true,
		sScrollY: '300px',
		bPaginate: false,
		bScrollInfinite: true,
		aoColumns: columns,
		fnRowCallback: function (node) {
			if (node.firstChild.tabIndex === 0)
				return (node);

			node.firstChild.tabIndex = 0;
			$(node.firstChild).keydown(function (event) {
				gHeatmapKeyPressed(id, event);
			});

			return (node);
		}
	});
	$(tbody).click(function (event) { gHeatmapRowClicked(id, event); });

	data = [];
	for (ii = 0; ii < gnDataPoints; ii++)
		data.push(null);

	/*
	 * Ask the server to begin instrumenting this metric.
	 */
	request = new XMLHttpRequest();
	request.open('POST', gUrlCreate(), true);
	request.setRequestHeader('Content-Type',
	    'application/x-www-form-urlencoded');
	request.send(body);
	request.onreadystatechange = function () {
		var value, gopts, errmsg;

		if (request.readyState != 4)
			return;

		if (request.status != 201) {
			container.removeChild(div);

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

			alert('failed to create stat: ' + errmsg);
			return;
		}

		value = JSON.parse(request.responseText);
		gopts = type == 'scalar' ? gScalarOptions : gVectorOptions;
		setTimeout(function () {
			gGraphs[id] = {
				inst_id: value.id,
				label: title,
				div: div,
				graph: elt,
				data: data,
				type: type,
				legend: legend,
				options: gopts,
				subtype: subtype,
				fillcb: fillcb(id),
				selected: {},
				hues: [],
				ncreated: 0,
				isolate: false,
				coloring: 'rank',
				weights: 'count'
			};
		}, 1000);
	};
}

/*
 * Delete the instrumentation for this graph and remove it from the page.
 */
function gRemoveStat(id, div)
{
	var url, request;

	url = gUrlDelete(gGraphs[id].inst_id);
	div.parentNode.removeChild(div);
	delete (gGraphs[id]);

	request = new XMLHttpRequest();
	request.open('DELETE', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200)
			alert('failed to delete stat: ' + request.statusText);
	};
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
