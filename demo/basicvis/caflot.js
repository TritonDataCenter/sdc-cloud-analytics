/*
 * caflot.js: flot-based visualization of CA metrics for demo
 */

var gServer = window.location.hostname;
var gBaseUrlValue = 'http://' + gServer + ':23182/instrumentation/';
var gBaseUrlCreate = 'http://' + gServer + ':23181/instrumentation';
var gBaseUrlMetrics = 'http://' + gServer + ':23181/metrics';
var gBaseColors = ['#edc240', '#afd8f8', '#cb4b4b', '#4da74d', '#9440ed'];
var gColors = [];
var gMaxSeries;

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

function gInitMetrics()
{
	var request;

	request = new XMLHttpRequest();
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to load metric list');
			return;
		}

		var val = JSON.parse(request.responseText);
		gInitMetricsFini(val);
	};
	request.open('GET', gUrlMetrics(), true);
	request.send(null);
}

function gInitMetricsFini(metrics)
{
	var modname, module, statname, stat, optname;
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

	gStatSelected();

	elt = document.getElementById('gStatAddButton');
	elt.disabled = false;
}

function gInitColors()
{
	var ii, jj, color;
	var variations = [ 0, -1 ];

	for (jj = 0; jj < variations.length; jj++) {
		for (ii = 0; ii < gBaseColors.length; ii++) {
			color = $.color.parse(gBaseColors[ii]);
			color.scale('rgb', 1 + variations[jj] * 0.2);
			gColors.push(color);
		}
	}

	gMaxSeries = gColors.length - 1;
}

function gTick()
{
	var key;

	for (key in gGraphs)
		gRetrieveData(key, gFillData(key));

	setTimeout(gTick, 1000);
}

function gRetrieveData(key, callback)
{
	var request;

	request = new XMLHttpRequest();
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		var val = JSON.parse(request.responseText);
		callback([ new Date(val.when * 1000), val.value ]);
	};

	request.open('GET', gUrlValue(gGraphs[key].inst_id), true);
	request.send(null);
}

function gFillData(key)
{
	return (function (datum) {
		var data;

		gGraphs[key].data.shift();
		gGraphs[key].data.push(datum);
		data = gRecomputeData(key);
		gGraphs[key].plot =
		    $.plot(gGraphs[key].graph, data, gGraphs[key].options);

		if (gGraphs[key].highlighted)
			gUpdateHighlighting(gGraphs[key],
			    gGraphs[key].highlighted - 1);

		if (!gGraphs[key].bound) {
			$(gGraphs[key].graph).bind('plotclick',
			    function (e, p, i) { gPlotClicked(key, p); });
			gGraphs[key].bound = true;
		}
	});
}

function gPlotClicked(id, pos)
{
	var graph = gGraphs[id];
	var when = Math.round(pos.x / 1000) * 1000;
	var text = '';
	var ii, jj, key, keys;

	for (ii = 0; ii < graph.data.length; ii++) {
		if (graph.data[ii] !== null &&
		    graph.data[ii][0].getTime() == when)
			break;
	}

	if (ii == graph.data.length)
		return;

	if (graph.type == 'scalar') {
		text += 'Value: ' + graph.data[ii][1];
	} else {
		keys = [];
		for (key in graph.data[ii][1])
			keys.push(key);
		keys.sort(function (k1, k2) {
			return (graph.data[ii][1][k2] - graph.data[ii][1][k1]);
		});

		for (jj = 0; jj < keys.length; jj++) {
			text += keys[jj] + ': ' +
			    graph.data[ii][1][keys[jj]] + '<br />';
		}
	}

	gPlotShow(id, text);
	gUpdateHighlighting(graph, ii);
}

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

function gPlotShow(id, text)
{
	gGraphs[id].text.innerHTML = text;
}

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
		row.color = gColors[ii].toString();
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
		row.color = gColors[gColors.length - 1].toString();
		series.push(row);
	}

	return (series);
}

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

function gUrlValue(id)
{
	return (gBaseUrlValue + id + '/value');
}

function gUrlCreate()
{
	return (gBaseUrlCreate);
}

function gUrlDelete(id)
{
	return (gBaseUrlCreate + '/' + id);
}

function gUrlMetrics()
{
	return (gBaseUrlMetrics);
}

function gAddStat()
{
	var statsel, decompsel, statoption, decompoption, metric, data, type;
	var id, ii, decomp, body, request;
	var container, div, link, title, elt, text;
	var table, tr, td;

	statsel = document.getElementById('gStatSelector');
	statoption = statsel.options[statsel.selectedIndex];
	decompsel = document.getElementById('gDecompositionSelector');
	decompoption = decompsel.options[decompsel.selectedIndex];

	metric = gMetrics[statoption.value];
	decomp = decompoption.value;

	id = gId++;
	title = statoption.text;
	body = 'module=' + metric.module + '&stat=' + metric.stat;

	if (decomp === '') {
		type = 'scalar';
	} else {
		type = 'vector';
		title += ' decomposed by ' + decompoption.text;
		body += '&decomposition=' + decomp;
	}

	container = document.getElementById('gContainerDiv');
	div = container.appendChild(document.createElement('div'));
	div.className = 'GraphContainer';

	elt = div.appendChild(document.createElement('h3'));
	link = elt.appendChild(document.createElement('a'));
	link.appendChild(document.createTextNode('x'));
	link.onclick = function () { gRemoveStat(id, div); };
	elt.appendChild(document.createTextNode(title));
	elt.title = body;

	table = div.appendChild(document.createElement('table'));
	tr = table.appendChild(document.createElement('tr'));
	td = tr.appendChild(document.createElement('td'));

	elt = td.appendChild(document.createElement('div'));
	elt.className = 'Graph';
	elt.id = 'graph' + id;
	elt.style.width = '600px';
	elt.style.height = '300px';

	text = td = tr.appendChild(document.createElement('td'));
	td.className = 'GraphText';

	data = [];
	for (ii = 0; ii < gnDataPoints; ii++)
		data.push(null);

	request = new XMLHttpRequest();
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 201) {
			link.parentNode.removeChild(link);
			alert('failed to create stat: ' + request.statusText);
			return;
		}

		var val = JSON.parse(request.responseText);
		var gopts = type == 'scalar' ? gScalarOptions : gVectorOptions;
		setTimeout(function () {
			gGraphs[id] = {
				inst_id: val.id,
				label: title,
				div: div,
				graph: elt,
				data: data,
				type: type,
				text: text,
				options: gopts
			};
		}, 1000);
	};
	request.open('POST', gUrlCreate(), true);
	request.setRequestHeader('Content-Type',
	    'application/x-www-form-urlencoded');
	request.send(body);
}

function gRemoveStat(key, div)
{
	var request = new XMLHttpRequest();
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to delete stat: ' + request.statusText);
			return;
		}

		div.parentNode.removeChild(div);
	};

	request.open('DELETE', gUrlDelete(gGraphs[key].inst_id), true);
	request.send(null);
	delete (gGraphs[key]);
}

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
}
