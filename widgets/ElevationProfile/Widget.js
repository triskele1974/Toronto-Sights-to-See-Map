///////////////////////////////////////////////////////////////////////////
// Robert Scheitlin WAB Elevation Profile Widget
///////////////////////////////////////////////////////////////////////////
/*global define, console*/
define([
  'dojo/_base/declare',
  'jimu/BaseWidget',
  'dojo/Evented',
  'dijit/_OnDijitClickMixin',
  'dijit/_WidgetsInTemplateMixin',
  'dojo/on',
  'dojo/aspect',
  'dojo/_base/lang',
  'dojo/_base/Deferred',
  'dojo/_base/array',
  'dojo/number',
  'dijit/registry',
  'put-selector/put',
  'dojo/dom-class',
  'dojo/_base/Color',
  'dojo/colors',
  'dojox/charting/Chart',
  'dojox/charting/axis2d/Default',
  'dojox/charting/plot2d/Grid',
  'dojox/charting/plot2d/Areas',
  'dojox/charting/action2d/MouseIndicator',
  'dojox/charting/action2d/TouchIndicator',
  'dojox/charting/themes/ThreeD',
  'esri/sniff',
  'esri/request',
  'esri/tasks/Geoprocessor',
  'esri/geometry/Polyline',
  'esri/symbols/SimpleLineSymbol',
  'esri/symbols/SimpleMarkerSymbol',
  'esri/graphic',
  'esri/tasks/FeatureSet',
  'esri/tasks/LinearUnit',
  'esri/geometry/geodesicUtils',
  'esri/geometry/webMercatorUtils',
  'esri/units',
  'jimu/utils',
  'esri/dijit/Measurement',
  'dojo/_base/html',
  'dijit/ProgressBar',
  'jimu/dijit/TabContainer',
  'jimu/dijit/Message',
  'dojo/dom-construct',
  'dojox/gfx/utils',
  'esri/config',
  'esri/tasks/ProjectParameters',
  'esri/SpatialReference',
  'jimu/BaseFeatureAction',
  'jimu/dijit/FeatureActionPopupMenu',
  'jimu/CSVUtils',
  'jimu/dijit/Message',
  'esri/layers/GraphicsLayer',
  './SegmentChooser',
  'jimu/WidgetManager',
  'jimu/PanelManager',
  'jimu/dijit/LoadingShelter'
],
  function (declare, BaseWidget, Evented, _OnDijitClickMixin, _WidgetsInTemplateMixin,
    on, aspect, lang, Deferred, array, number, registry,
    put, domClass, Color, colors,
    Chart, Default, Grid, Areas, MouseIndicator, TouchIndicator, ThreeD, esriSniff,
    esriRequest, Geoprocessor, Polyline, SimpleLineSymbol, SimpleMarkerSymbol,
    Graphic, FeatureSet, LinearUnit, geodesicUtils, webMercatorUtils, Units, jimuUtils,
    Measurement, html, ProgressBar, TabContainer, Message, domConstruct,
    gfxUtils, esriConfig, ProjectParameters, SpatialReference, BaseFeatureAction,
    PopupMenu, CSVUtils, Message, GraphicsLayer, SegmentChooser, WidgetManager,
    PanelManager) {
    return declare([BaseWidget, _OnDijitClickMixin, _WidgetsInTemplateMixin, Evented], {

      baseClass: 'widget-elevation-profile',
      declaredClass: 'ElevationsProfile',
      samplingPointCount: 199,
      profileService: null,
      loaded: false,
      domNode: put('div#profileChartNode'),
      profileTaskUrl: null,
      scalebarUnits: null,
      elevLineSymbol: null,
      measureTool: null,
      lastMeasure: null,
      _sourceStr: null,
      _gainLossStr: null,
      _hasCanvasSupport: false,
      isIE: false,
      popupMenu: null,
      currentProfileResults: null,
      profileInfo: null,
      prepareVis: false,
      eFeatGL: null,

      /**
       *  POSTCREATE - CONNECT UI ELEMENT EVENTS
       */
      postCreate: function () {
        this.inherited(arguments);
        this.popupMenu = PopupMenu.getInstance();
        this.isIE = jimuUtils.has("ie") || jimuUtils.has("edge")
        this._hasCanvasSupport = !!window.CanvasRenderingContext2D;
        this.scalebarUnits = this.config.scalebarUnits;
        this.chartRenderingOptions = lang.mixin({}, this.config.chartRenderingOptions);
        this.profileServiceUrl = lang.replace('{0}/Profile', [this.config.profileTaskUrl]);
        this.own(
          aspect.after(registry.getEnclosingWidget(this.domNode), 'resize', lang.hitch(this, this._resizeChart), true)
        );
        this._initProfileService = lang.hitch(this, this._initProfileService);
        this.displayProfileChart = lang.hitch(this, this.displayProfileChart);
        this.clearProfileChart = lang.hitch(this, this.clearProfileChart);
        this._updateProfileChart = lang.hitch(this, this._updateProfileChart);
        this._createProfileChart = lang.hitch(this, this._createProfileChart);
        this._getDisplayValue = lang.hitch(this, this._getDisplayValue);
        this._initMeasureTool = lang.hitch(this, this._initMeasureTool);
        this._initTabContainer();
        this._initProgressBar();

        if (this.config.symbols && this.config.symbols.simplelinesymbol) {
          this.elevLineSymbol = new SimpleLineSymbol(this.config.symbols.simplelinesymbol);
        } else {
          this.elevLineSymbol = new SimpleLineSymbol();
        }
        this._initMeasureTool();

        this.own(on(this.domNode, 'mousedown', lang.hitch(this, function (event) {
          event.stopPropagation();
          if (event.altKey) {
            var msgStr = this.nls.widgetverstr + ': ' + this.manifest.version;
            msgStr += '\n' + this.nls.wabversionmsg + ': ' + this.manifest.wabVersion;
            msgStr += '\n' + this.manifest.description;
            new Message({
              titleLabel: this.nls.widgetversion,
              message: msgStr
            });
          }
        })));
        this.eFeatGL = new GraphicsLayer();
        this.map.addLayer(this.eFeatGL);
      },

      _onBtnMenuClicked: function(evt){
        var position = html.position(evt.target || evt.srcElement);
        var actions = [];

        var infoAction = new BaseFeatureAction({
          name: "profileInfo",
          iconClass: 'icon-info',
          label: this.nls.profileinfo,
          iconFormat: 'svg',
          map: this.map,
          onExecute: lang.hitch(this, function(){
            new Message({
              titleLabel: this.nls.profileinfo,
              message: this.profileInfo
            });
          })
        });
        infoAction.name = "profileInfo";
        infoAction.data = {};
        actions.push(infoAction);

        if(this._hasCanvasSupport && !this.isIE){
          if(this.prepareVis){
            var prepareAction = new BaseFeatureAction({
              name: "prepareDownload",
              iconClass: 'icon-set-as-input',
              label: this.nls.prepare,
              iconFormat: 'svg',
              map: this.map,
              onExecute: lang.hitch(this, this._export)
            });
            prepareAction.name = "prepareDownload";
            prepareAction.data = {};
            actions.push(prepareAction);
          }
        }

        var exportCSVAction = new BaseFeatureAction({
          name: "eExportToCSV",
          iconClass: 'icon-export',
          label: this.nls.exportToCSV,
          iconFormat: 'svg',
          map: this.map,
          onExecute: lang.hitch(this, function(){
            CSVUtils.exportCSV("Elevation Profile Data", this.currentProfileResults.data, this.currentProfileResults.columns);
          })
        });
        exportCSVAction.name = "eExportToCSV";
        exportCSVAction.data = {};
        actions.push(exportCSVAction);

        var flipProfileAction = new BaseFeatureAction({
          name: "flipProfile",
          iconClass: 'icon-show-related-record',
          label: this.nls.flipProfile,
          iconFormat: 'svg',
          map: this.map,
          onExecute: lang.hitch(this, this._flipProfile)
        });
        flipProfileAction.name = "flipProfile";
        flipProfileAction.data = {};
        actions.push(flipProfileAction);

        var removeAction = new BaseFeatureAction({
          name: "ClearProfile",
          iconClass: 'icon-close',
          label: this.nls.clear,
          iconFormat: 'svg',
          map: this.map,
          onExecute: lang.hitch(this, this._clear)
        });
        removeAction.name = "ClearProfile";
        removeAction.data = {};
        actions.push(removeAction);

        this.popupMenu.setActions(actions);
        this.popupMenu.show(position);
      },

      /**
       *  STARTUP THE DIJIT
       */
      startup: function () {
        this.inherited(arguments);
        this._initUI();
      },

      _initTabContainer: function () {
        var tabs = [];
        tabs.push({
          title: this.nls.measurelabel,
          content: this.tabNode1
        });
        tabs.push({
          title: this.nls.resultslabel,
          content: this.tabNode2
        });
        this.selTab = this.nls.measurelabel;
        this.tabContainer = new TabContainer({
          tabs: tabs,
          selected: this.selTab
        }, this.tabMain);

        this.tabContainer.startup();
        this.own(on(this.tabContainer, 'tabChanged', lang.hitch(this, function (title) {
          if (title !== this.nls.resultslabel) {
            this.selTab = title;
          }
          this._resizeChart();
        })));
        jimuUtils.setVerticalCenter(this.tabContainer.domNode);
        html.setStyle(this.btnDownload, 'display', 'none');
      },

      _initProgressBar: function () {
        this.progressBar = new ProgressBar({
          indeterminate: true
        }, this.progressbar);
        html.setStyle(this.progressBar.domNode, 'display', 'none');
      },

      onClose: function () {
        if (this.measureTool) {
          this.measureTool.setTool("distance", false);
          this.measureTool.clearResult();
          this._displayChartLocation(-1);
        }
      },

      onOpen: function () {
        if (this.lastMeasure && this.measureTool) {
          this.measureTool.measure(this.lastMeasure);
        }
        var panel = this.getPanel();
        var pos = panel.position;
        if(this.appConfig.theme.name === 'TabTheme') {
          var sbc = WidgetManager.getInstance().getWidgetsByName("SidebarController")[0];
          pos.width = sbc.maxWidth;
        }else{
          pos.width = this.config.width || 720;
          panel.setPosition(pos);
          panel.panelManager.normalizePanel(panel);
        }
      },

      /**
       * INITIALIZE ESRI MEASUREMENT DIJIT
       *
       * @private
       */
      _initMeasureTool: function () {
        // MEASUREMENT TOOL //
        this.measureTool = new Measurement({
          map: this.map,
          lineSymbol: this.elevLineSymbol,
          defaultAreaUnit: (this.scalebarUnits === 'metric') ? Units.SQUARE_KILOMETERS : Units.SQUARE_MILES,
          defaultLengthUnit: (this.scalebarUnits === 'metric') ? Units.KILOMETERS : Units.MILES
        }, this._measureNode);
        aspect.after(this.measureTool, 'setTool', lang.hitch(this, function () {
          if (this.measureTool.activeTool) {
            this.map.setInfoWindowOnClick(false);
            this.disableWebMapPopup();
          } else {
            this.map.setInfoWindowOnClick(true);
            this.enableWebMapPopup();
          }
        }));
        this.measureTool.startup();

        // HIDE AREA AND LOCATION TOOLS //
        this.measureTool.hideTool('area');
        this.measureTool.hideTool('location');

        //Activate then deactivate the distance tool to enable the measure units
        on.once(this.measureTool, "tool-change", lang.hitch(this, function () {
          this.measureTool.setTool("distance", false);
          this.measureTool.clearResult();
        }));
        this.measureTool.setTool("distance", true);

        // CREATE PROFILE ON DISTANCE MEASURE-END EVENT //
        this.measureTool.on('measure-end', lang.hitch(this, this._onMeasureEnd));

        // Clear existing profiles when distance tool is clicked.
        this.measureTool._distanceButton.on("click", lang.hitch(this, this._onMeasureClick));

        // Update the chart when units change
        on(this.measureTool, "unit-change", lang.hitch(this, this._unitsChanged), true);
      },

      disableWebMapPopup: function () {
        if (this.map && this.map.webMapResponse) {
          var handler = this.map.webMapResponse.clickEventHandle;
          if (handler) {
            handler.remove();
            this.map.webMapResponse.clickEventHandle = null;
          }
        }
      },

      enableWebMapPopup: function () {
        if (this.map && this.map.webMapResponse) {
          var handler = this.map.webMapResponse.clickEventHandle;
          var listener = this.map.webMapResponse.clickEventListener;
          if (listener && !handler) {
            this.map.webMapResponse.clickEventHandle = on(
              this.map,
              'click',
              lang.hitch(this.map, listener)
            );
          }
        }
      },

      /**
       * MEASUREMENT DISTACE TOOL CLICK
       *
       * @private
       */
      _onMeasureClick: function () {
        this.clearProfileChart();
        this.map.infoWindow.clearFeatures();
        this.map.infoWindow.hide();
        this.emit("measure-distance-checked", {
          checked: this.measureTool._distanceButton.checked
        });
      },

      _onMeasureEnd: function (evt) {
        if (evt.toolName === "distance") {
          this.tabContainer.selectTab(this.nls.resultslabel);
          if (!this.map.spatialReference.isWebMercator()){
            var params = new ProjectParameters();
            params.geometries = [evt.geometry];
            params.outSR = new SpatialReference(102100);
            esriConfig.defaults.geometryService.project(params, lang.hitch(this, function(results){
              this.lastMeasure = results[0];
              this.displayProfileChart(results[0]);
            }));
          }else{
            this.lastMeasure = evt.geometry;
            this.displayProfileChart(evt.geometry);
          }
        }
      },

      openWidgetandProfileLine: function(feat){
        if(this.inPanel){
          var panel = this.getPanel();
          if(this.appConfig.theme.name === 'JewelryBoxTheme'){
            PanelManager.getInstance().maximizePanel(panel);
          }else if(this.appConfig.theme.name === 'TabTheme') {
            var sbc = WidgetManager.getInstance().getWidgetsByName("SidebarController")[0];
            var configs = sbc.getAllConfigs();
            var tIndex;
            array.some(configs, function(g, index) {
              if(g.name === 'ElevationProfile'){
                tIndex = index;
                return true;
              }
            })
            if(tIndex !== null){
              if(tIndex > 4){
                var tab = sbc.tabs[4];
                var groups = tab.config.groups
                array.some(groups, function(g, index) {
                  if(g.name === 'ElevationProfile'){
                    sbc._onOtherGroupClick(g);
                    return true;
                  }
                });
              }else{
                sbc.selectTab(tIndex,{a11y_byKeyEvent:true});
              }
              sbc._resizeToMax();
            }
          }else{
            PanelManager.getInstance().normalizePanel(panel);
          }
        }else{
          WidgetManager.getInstance().triggerWidgetOpen(this.id);
        }
        setTimeout(lang.hitch(this, function(){
          this._profileLine(feat);
        }), 500);
      },

      _profileLine: function(feat){
        this.eFeatGL.clear();
        this.tabContainer.selectTab(this.nls.resultslabel);
        this.map.infoWindow.hide();
        this.clearProfileChart();
        
        var pLine = new Polyline(new SpatialReference({wkid:102100}));
        if (!feat.geometry.spatialReference.isWebMercator()){
          var params = new ProjectParameters();
          params.geometries = [feat.geometry];
          params.outSR = new SpatialReference(102100);
          esriConfig.defaults.geometryService.project(params, lang.hitch(this, function(results){
            if(results[0].paths.length > 1){
              var sc = new SegmentChooser({
                segmentsArr: results[0].paths,
                autoHeight: true,
                width: 400,
                titleLabel: this.nls.pathchoicetitle,
                folderurl: this.folderUrl,
                nls: this.nls,
                pWidget: this
              });
              on(sc, "click", lang.hitch(this, function(evt){
                pLine.addPath(results[0].paths[evt]);
                this._linePathChoosen(pLine);
              }));
            }else{
              pLine = results[0];
              this._linePathChoosen(pLine);
            }
          }));
        }else{
          if(feat.geometry.paths.length > 1){
            var sc = new SegmentChooser({
              segmentsArr: feat.geometry.paths,
              autoHeight: true,
              width: 400,
              titleLabel: this.nls.pathchoicetitle,
              folderurl: this.folderUrl,
              nls: this.nls,
              pWidget: this
            });
            on(sc, "click", lang.hitch(this, function(evt){
              pLine.addPath(feat.geometry.paths[evt]);
              this._linePathChoosen(pLine);
            }));
          }else{
            pLine = feat.geometry;
            this._linePathChoosen(pLine);
          }
        }
      },

      _linePathChoosen: function(pLine){
        var sfGra = new Graphic(pLine, this.map.infoWindow.lineSymbol);
        this.eFeatGL.add(sfGra);
        this.lastMeasure = pLine;
        this.displayProfileChart(pLine);
      },

      _downloadCanvas: function(link, canvas, filename){
        link.href = canvas.toDataURL("image/jpeg");
        link.download = filename;
        // html.setStyle(this.btnExport, 'display', 'none');
        this.prepareVis = false;
        html.setStyle(this.btnDownload, 'display', 'block');
      },

      _export: function(evt) {
        gfxUtils.toSvg(this.profileChart.surface).then(lang.hitch(this, function(svg) {
          var canvas = document.createElement('canvas');
          canvas.width = this.profileChart.dim.width;
          canvas.height = this.profileChart.dim.height;
          var context = canvas.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0,0,canvas.width,canvas.height)

          var URL = window.URL || window.webkitURL;
          var data = new Blob([svg], {type: "image/svg+xml;charset=utf-8"});
          var url = URL.createObjectURL(data);
          var image = new Image();
          image.crossOrigin = '';
          image.onload = lang.hitch(this, function() {
              context.drawImage(image, 0, 0);
              URL.revokeObjectURL(url);
              this._downloadCanvas(this.btnDownload, canvas, 'Profile.jpg');
          })
          image.src = url;
        }));
      },

      _clear: function () {
        this.lastMeasure = null;
        this.currentProfileResults = null;
        html.setStyle(this.divOptions, 'display', 'none');
        this.prepareVis = false;
        html.setStyle(this.btnDownload, 'display', 'none');
        this.clearProfileChart();
        this.tabContainer.selectTab(this.nls.measurelabel);
        this.measureTool.clearResult();
        this.eFeatGL.clear();
        return false;
      },

      /**
       * INITIALIZE THE UI
       *
       * @private
       */
      _initUI: function () {
        if (this.chartRenderingOptions.constrain) {
          domClass.add(this._chartNode, "PanelMax");
        }
        // MAKE SURE WE HAVE ACCESS TO THE PROFILE SERVICE //
        this._initProfileService().then(lang.hitch(this, function () {
          this._updateProfileChart();
          // DIJIT SUCCESSFULLY LOADED //
          this.loaded = true;
          this.emit('load', {});
        }), lang.hitch(this, function () {
          this.emit('error', new Error(this.nls.errors.InvalidConfiguration));
          this.destroy();
        }));
      },

      /**
       * INITIALIZE THE PROFILE SERVICE
       *
       * @returns {*}
       * @private
       */
      _initProfileService: function () {
        var deferred = new Deferred();

        if (this.profileServiceUrl) {
          // MAKE SURE PROFILE SERVICE IS AVAILABLE //
          esriRequest({
            url: this.profileServiceUrl,
            content: {
              f: 'json'
            },
            callbackParamName: 'callback'
          }).then(lang.hitch(this, function (taskInfo) {
            //console.log('GP Service Details: ', taskInfo);

            // TASK DETAILS //
            this.taskInfo = taskInfo;

            // CREATE GP PROFILE SERVICE //
            this.profileService = new Geoprocessor(this.profileServiceUrl);
            this.profileService.setOutSpatialReference(this.map.spatialReference);

            // SAMPLING DISTANCE //
            this.samplingDistance = new LinearUnit();
            this.samplingDistance.units = Units.METERS;

            deferred.resolve();
          }), lang.hitch(this, function (error) {
            deferred.reject(error);
          }));
        } else {
          deferred.reject(new Error(this.nls.errors.InvalidConfiguration));
        }

        return deferred.promise;
      },

      /**
       * GET PROFILE OVER POLYLINE FROM PROFILE SERVICE
       *
       * @param polyline
       * @returns {*}
       * @private
       */
      _getProfile: function (polyline) {
        var deferred = new Deferred();

        // CONVERT WEBMERCATOR POLYLINE TO GEOGRAPHIC        //
        // - IF NOT WEBMERCATOR ASSUME ALREADY IN GEOGRAPHIC //
        var geoPolyline = (polyline.spatialReference.isWebMercator()) ? webMercatorUtils.webMercatorToGeographic(polyline) : polyline;
        // GET LENGTH IN METERS //
        var profileLengthMeters = geodesicUtils.geodesicLengths([geoPolyline], Units.METERS)[0];
        // GET SAMPLING DISTANCE //
        var samplingDistance = (profileLengthMeters / this.samplingPointCount);

        // CREATE GP TASK INPUT FEATURE SET //
        var inputProfileGraphic = new Graphic(polyline, null, {
          OID: 1
        });
        var inputLineFeatures = new FeatureSet();
        inputLineFeatures.features = [inputProfileGraphic];
        // MAKE SURE OID FIELD IS AVAILABLE TO GP SERVICE //
        inputLineFeatures.fields = [
          {
            'name': 'OID',
            'type': 'esriFieldTypeObjectID',
            'alias': 'OID'
        }
      ];

        // MAKE GP REQUEST //
        this.profileService.execute({
          'InputLineFeatures': inputLineFeatures,
          'ProfileIDField': 'OID',
          'DEMResolution': 'FINEST',
          'MaximumSampleDistance': samplingDistance,
          'MaximumSampleDistanceUnits': 'Meters',
          'returnZ': true,
          'returnM': true
        }).then(lang.hitch(this, function (results) {

          // GET RESULT //
          if (results.length > 0) {
            var profileOutput = results[0].value;
            // GET PROFILE FEATURE //
            if (profileOutput.features.length > 0) {
              var profileFeature = profileOutput.features[0];
              // SET DEM RESOLUTION DETAILS //
              this._sourceStr = lang.replace('{0}: {1}', [this.nls.chart.demResolution, profileFeature.attributes.DEMResolution]);

              // GET PROFILE GEOMETRY //
              var profileGeometry = profileFeature.geometry;
              var allElevations = [];
              var allDistances = [];

              if (profileGeometry.paths.length > 0) {
                // POLYLINE PATHS //
                array.forEach(profileGeometry.paths, lang.hitch(this, function (profilePoints, pathIndex) {
                  // ELEVATION INFOS //
                  array.forEach(profilePoints, lang.hitch(this, function (coords, pointIndex) {
                    var elevationInfo = {
                      x: ((coords.length > 3) ? coords[3] : (pointIndex * samplingDistance)),
                      y: ((coords.length > 2) ? coords[2] : 0.0),
                      pathIdx: pathIndex,
                      pointIdx: pointIndex
                    };
                    allElevations.push(elevationInfo);
                    allDistances.push(elevationInfo.x);
                  }));
                }));

                // RESOLVE TASK //
                deferred.resolve({
                  geometry: profileGeometry,
                  elevations: allElevations,
                  distances: allDistances,
                  samplingDistance: samplingDistance
                });
              } else {
                deferred.reject(new Error(this.nls.errors.UnableToProcessResults));
              }
            } else {
              deferred.reject(new Error(this.nls.errors.UnableToProcessResults));
            }
          } else {
            deferred.reject(new Error(this.nls.errors.UnableToProcessResults));
          }
        }), deferred.reject);

        return deferred.promise;
      },


      /**
       * DISPLAY PROFILE CHART
       *
       * @param geometry
       * @returns {*}
       */
      displayProfileChart: function (geometry) {
        html.setStyle(this.divOptions, 'display', 'none');
        html.setStyle(this.btnDownload, 'display', 'none');
        html.setStyle(this.progressBar.domNode, 'display', 'block');
        this._getProfile(geometry).then(lang.hitch(this, function (elevationInfo) {
          this.elevationInfo = elevationInfo;
          this._updateProfileChart();
          this.emit('display-profile', elevationInfo);
          html.setStyle(this.divOptions, 'display', 'block');
          this.prepareVis = true;
          html.setStyle(this.progressBar.domNode, 'display', 'none');
        }), lang.hitch(this, function (error) {
          html.setStyle(this.progressBar.domNode, 'display', 'none');
          alert(lang.replace('{message}\n\n{details.0}', error));
          this.emit('error', error);
        }));
      },

      /**
       * CLEAR PROFILE CHART
       *
       * @private
       */
      clearProfileChart: function () {
        this.elevationInfo = null;
        this._updateProfileChart();
        this.emit('clear-profile', {});
      },

      /**
       * UPDATE PROFILE CHART
       *
       * @private
       */
      _updateProfileChart: function () {
        html.setStyle(this.divOptions, 'display', 'none');
        html.setStyle(this.progressBar.domNode, 'display', 'block');
        this._createProfileChart(this.elevationInfo).then(lang.hitch(this, function () {
          this.profileChart.resize();
          html.setStyle(this.progressBar.domNode, 'display', 'none');
        }), lang.hitch(this, function (error) {
          html.setStyle(this.progressBar.domNode, 'display', 'none');
          this.emit('error', error);
        }));
      },

      _unitsChanged: function () {
        //Check to see if the measure tool is active. If so call update profile chart
        if (this.measureTool._distanceButton.checked) {
          //measure tool
          this._updateProfileChart();
        }
      },

      _flipProfile: function () {
        var oPath = this.lastMeasure.paths[0];
        this.lastMeasure.removePath(0);
        oPath.reverse();
        this.lastMeasure.addPath(oPath);
        this.displayProfileChart(this.lastMeasure);
      },

      /**
       * CREATE PROFILE CHART
       *
       * @param elevationInfo
       * @returns {*}
       * @private
       */
      _createProfileChart: function (elevationInfo) {
        var deferred = new Deferred();

        // CHART SERIES NAMES //
        var waterDataSeriesName = 'Water';
        var elevationDataSeriesName = 'ElevationData';
        var myDataSeriesName = 'Mine';

        // MIN/MAX/STEP //
        var yMin = -10.0;
        var yMax = 100.0;

        // DID WE GET NEW ELEVATION INFORMATION //
        if (!elevationInfo) {
          // CLEAR GRAPHIC FROM MAP //
          this._displayChartLocation(-1);

          if(!this.samplingDistance){
            this.samplingDistance = new LinearUnit();
            this.samplingDistance.units = Units.METERS;
          }

          // SAMPLING DISTANCE //
          this.samplingDistance.distance = (this.map.extent.getWidth() / this.samplingPointCount);

          // GEOMETRY AND ELEVATIONS //
          this.profilePolyline = null;
          var samplingDisplayDistance = this._convertDistancesArray([this.samplingDistance.distance])[0];
          this.elevationData = this._getFilledArray(this.samplingPointCount, samplingDisplayDistance, true);

          // CLEAR GAIN/LOSS AND SOURCE DETAILS //
          this._gainLossStr = '';
          this._sourceStr = '';

          // REMOVE ELEVATION INDICATORS //
          if (this.elevationIndicator) {
            this.elevationIndicator.destroy();
            this.elevationIndicator = null;
          }
          if (this.elevationIndicator2) {
            this.elevationIndicator2.destroy();
            this.elevationIndicator2 = null;
          }
          if (this.elevationIndicator3) {
            this.elevationIndicator3.destroy();
            this.elevationIndicator3 = null;
          }
        } else {
          // GEOMETRY, ELEVATIONS, DISTANCES AND SAMPLING DISTANCE //
          this.profilePolyline = elevationInfo.geometry;
          this.elevationData = this._convertElevationsInfoArray(elevationInfo.elevations);
          this.distances = this._convertDistancesArray(elevationInfo.distances);
          this.samplingDistance.distance = this._convertDistancesArray([elevationInfo.samplingDistance.distance])[0];

          // CALC MIN/MAX/STEP //
          var yMinSource = this._getArrayMin(this.elevationData);
          var yMaxSource = this._getArrayMax(this.elevationData);
          var yRange = (yMaxSource - yMinSource);
          yMin = yMinSource - (yRange * 0.05);
          yMax = yMaxSource + (yRange * 0.05);

          // GAIN/LOSS DETAILS //
          var detailsNumberFormat = {
            places: 0
          };
          var elevFirst = this.elevationData[0].y;
          var elevLast = this.elevationData[this.elevationData.length - 1].y;
          var gainLossDetails = {
            min: number.format(yMinSource, detailsNumberFormat),
            max: number.format(yMaxSource, detailsNumberFormat),
            start: number.format(elevFirst, detailsNumberFormat),
            end: number.format(elevLast, detailsNumberFormat),
            gainloss: number.format((elevLast - elevFirst), detailsNumberFormat),
            unit: this._getDisplayUnits(true)
          };
          this._gainLossStr = lang.replace(this.nls.chart.gainLossTemplate, gainLossDetails);
          this.profileInfo = this._gainLossStr + "<br>" + this._sourceStr;

          // REMOVE ELEVATION INDICATORS //
          if (this.elevationIndicator) {
            this.elevationIndicator.destroy();
            this.elevationIndicator = null;
          }
          if (this.elevationIndicator2) {
            this.elevationIndicator2.destroy();
            this.elevationIndicator2 = null;
          }
          if (this.elevationIndicator3) {
            this.elevationIndicator3.destroy();
            this.elevationIndicator3 = null;
          }

          // MOUSE/TOUCH ELEVATION INDICATOR //
          var indicatorProperties = {
            series: elevationDataSeriesName,
            mouseOver: true,
            font: 'normal normal bold 9pt Tahoma',
            fontColor: this.chartRenderingOptions.indicatorFontColor,
            fill: this.chartRenderingOptions.indicatorFillColor,
            markerFill: 'none',
            markerStroke: {
              color: 'red',
              width: 3.0
            },
            markerSymbol: 'm -6 -6, l 12 12, m 0 -12, l -12 12', // RED X //
            offset: {
              y: -2,
              x: -25
            },
            labelFunc: lang.hitch(this, function (obj) {
              this._displayChartLocation(obj.x);
              var elevUnitsLabel = this._getDisplayUnits(true);
              var elevChangeLabel = number.format(obj.y, detailsNumberFormat);
              return lang.replace('{0} {1}', [elevChangeLabel, elevUnitsLabel]);
            })
          };
          // MOUSE/TOUCH ELEVATION CHANGE INDICATOR //
          var indicatorProperties2 = {
            series: waterDataSeriesName,
            mouseOver: true,
            font: 'normal normal bold 8pt Tahoma',
            fontColor: this.chartRenderingOptions.indicatorFontColor,
            fill: this.chartRenderingOptions.indicatorFillColor,
            fillFunc: lang.hitch(this, function (obj) {
              var elevIndex = this.distances.indexOf(obj.x);
              var elev = this.elevationData[elevIndex].y;
              return (elev >= elevFirst) ? 'green' : 'red';
            }),
            offset: {
              y: 25,
              x: -30
            },
            labelFunc: lang.hitch(this, function (obj) {
              var elevIndex = this.distances.indexOf(obj.x);
              var elev = this.elevationData[elevIndex].y;
              var elevChangeLabel = number.format(elev - elevFirst, detailsNumberFormat);
              var plusMinus = ((elev - elevFirst) > 0) ? '+' : '';
              return lang.replace('{0}{1}', [plusMinus, elevChangeLabel]);
            })
          };
          if (esriSniff('has-touch')) {
            this.elevationIndicator2 = new TouchIndicator(this.profileChart, 'default', indicatorProperties2);
            this.elevationIndicator = new TouchIndicator(this.profileChart, 'default', indicatorProperties);
          } else {
            this.elevationIndicator2 = new MouseIndicator(this.profileChart, 'default', indicatorProperties2);
            this.elevationIndicator = new MouseIndicator(this.profileChart, 'default', indicatorProperties);
          }
          this.profileChart.fullRender();
        }

        if(this.elevationInfo){
          var csvData = [];
          for(var e = 0; e < this.elevationData.length; e++){
            var csvRow = {};
            csvRow["X"] = this.elevationInfo.geometry.paths[0][e][0];
            csvRow["Y"] = this.elevationInfo.geometry.paths[0][e][1];
            csvRow["Elevation"] = this.elevationData[e].y;
            csvRow["Distance"] = this.distances[e];
            csvData.push(csvRow);
          }
          this.currentProfileResults = {
            data: csvData,
            columns: ["X", "Y", "Elevation", "Distance"]
          }
        }

        // FILLED ZERO ARRAY //
        var waterData = this._resetArray(this.elevationData, 0.0);
        var myData = this._resetArray(this.elevationData, 0.0);

        // ARE WE UPDATING OR CREATING THE CHART //
        if (this.profileChart != null) {
          // UPDATE CHART //
          this.profileChart.getAxis('y').opt.min = yMin;
          this.profileChart.getAxis('y').opt.max = yMax;
          this.profileChart.getAxis('y').opt.title = lang.replace(this.nls.chart.elevationTitleTemplate, [this._getDisplayUnits(true)]);
          this.profileChart.getAxis('x').opt.title = lang.replace(this.nls.chart.distanceTitleTemplate, [this._getDisplayUnits(false)]);
          this.profileChart.dirty = true;
          this.profileChart.updateSeries(waterDataSeriesName, waterData);
          this.profileChart.updateSeries(elevationDataSeriesName, this.elevationData);
          this.profileChart.updateSeries(myDataSeriesName, myData);
          // RENDER CHART //
          this.profileChart.render();
          deferred.resolve();

        } else {

          // CREATE CHART //
          this.profileChart = new Chart(this._chartNode, {
            title: this.nls.chart.title,
            titlePos: 'top',
            titleGap: 13,
            titleFont: lang.replace('normal normal bold {chartTitleFontSize}pt verdana', this.chartRenderingOptions),
            titleFontColor: this.chartRenderingOptions.titleFontColor
          });

          // SET THEME //
          this.profileChart.setTheme(ThreeD);

          // OVERRIDE DEFAULTS //
          this.profileChart.fill = 'transparent';
          this.profileChart.theme.axis.stroke.width = 2;
          this.profileChart.theme.axis.majorTick.color = Color.named.white.concat(0.5);
          this.profileChart.theme.axis.majorTick.width = 1.0;
          this.profileChart.theme.plotarea.fill = {
            type: 'linear',
            space: 'plot',
            x1: 50,
            y1: 100,
            x2: 50,
            y2: 0,
            colors: [
              {
                offset: 0.0,
                color: this.chartRenderingOptions.skyTopColor
              },
              {
                offset: 1.0,
                color: this.chartRenderingOptions.skyBottomColor
              }
          ]
          };

          // Y AXIS //
          this.profileChart.addAxis('y', {
            min: yMin,
            max: yMax,
            fontColor: this.chartRenderingOptions.axisFontColor,
            font: lang.replace('normal normal bold {axisLabelFontSize}pt verdana', this.chartRenderingOptions),
            vertical: true,
            natural: true,
            fixed: true,
            includeZero: false,
            majorLabels: true,
            minorLabels: true,
            majorTicks: true,
            minorTicks: true,
            htmlLabels: false,
            majorTick: {
              color: this.chartRenderingOptions.axisMajorTickColor,
              length: 6
            },
            title: lang.replace(this.nls.chart.elevationTitleTemplate, [this._getDisplayUnits(true)]),
            titleGap: 30,
            titleFont: lang.replace('normal normal bold {axisTitleFontSize}pt verdana', this.chartRenderingOptions),
            titleFontColor: this.chartRenderingOptions.titleFontColor,
            titleOrientation: 'axis'
          });

          // X AXIS //
          this.profileChart.addAxis('x', {
            fontColor: this.chartRenderingOptions.axisFontColor,
            font: lang.replace('normal normal bold {axisLabelFontSize}pt verdana', this.chartRenderingOptions),
            natural: true,
            fixed: true,
            includeZero: false,
            majorLabels: true,
            minorLabels: true,
            majorTicks: true,
            minorTicks: true,
            htmlLabels: false,
            majorTick: {
              color: this.chartRenderingOptions.axisMajorTickColor,
              length: 6
            },
            title: lang.replace(this.nls.chart.distanceTitleTemplate, [this._getDisplayUnits(false)]),
            titleGap: 5,
            titleFont: lang.replace('normal normal bold {axisTitleFontSize}pt verdana', this.chartRenderingOptions),
            titleFontColor: this.chartRenderingOptions.titleFontColor,
            titleOrientation: 'away'
          });

          // GRID //
          this.profileChart.addPlot('grid', {
            type: Grid,
            hMajorLines: true,
            hMinorLines: false,
            vMajorLines: false,
            vMinorLines: false
          });

          // PROFIlE PLOT //
          this.profileChart.addPlot('default', {
            type: Areas,
            tension: 'X'
          });

          // WATER PLOT //
          this.profileChart.addPlot('water', {
            type: Areas
          });

          // MINE PLOT //
          this.profileChart.addPlot('mine', {
            type: Areas
          });

          // WATER DATA //
          this.profileChart.addSeries(waterDataSeriesName, waterData, {
            plot: 'water',
            stroke: {
              width: 2.0,
              color: this.chartRenderingOptions.waterLineColor
            },
            fill: {
              type: 'linear',
              space: 'plot',
              x1: 50,
              y1: 0,
              x2: 50,
              y2: 100,
              colors: [
                {
                  offset: 0.0,
                  color: this.chartRenderingOptions.waterTopColor
                },
                {
                  offset: 1.0,
                  color: this.chartRenderingOptions.waterBottomColor
                }
            ]
            }
          });

          this.profileChart.addSeries(myDataSeriesName, myData, {
            plot: 'water',
            stroke: {
              width: 2.0,
              color: this.chartRenderingOptions.waterLineColor
            },
            fill: {
              type: 'linear',
              space: 'plot',
              x1: 50,
              y1: 0,
              x2: 50,
              y2: 100,
              colors:[
                {
                  offset: 0.0,
                  color: this.chartRenderingOptions.waterTopColor
                },
                {
                  offset: 1.0,
                  color: this.chartRenderingOptions.waterBottomColor
                }
              ]
            }
          });

          // PROFILE DATA //
          this.profileChart.addSeries(elevationDataSeriesName, this.elevationData, {
            plot: 'default',
            stroke: {
              width: 1.5,
              color: this.chartRenderingOptions.elevationLineColor
            },
            fill: {
              type: 'linear',
              space: 'plot',
              x1: 50,
              y1: 0,
              x2: 50,
              y2: 100,
              colors: [
                {
                  offset: 0.0,
                  color: this.chartRenderingOptions.elevationTopColor
                },
                {
                  offset: 1.0,
                  color: this.chartRenderingOptions.elevationBottomColor
                }
            ]
            }
          });

          // RENDER CHART //
          this.profileChart.render();
          deferred.resolve();
        }

        return deferred.promise;
      },

      /**
       * RESIZE PROFILE CHART
       *
       * @private
       */
      _resizeChart: function () {
        if (this.profileChart) {
          this.profileChart.resize();
        }
      },

      /**
       * DISPLAY CHART LOCATION AS RED X GRAPHIC ON MAP
       *
       * @param {Number} chartObjectX
       */
      _displayChartLocation: function (chartObjectX) {
        if (this.map && this.elevationData && this.profilePolyline) {

          if (!this.chartLocationGraphic) {
            // CREATE LOCATION GRAPHIC //
            var red = new Color(Color.named.red);
            var outline = new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, red, 3);
            var chartLocationSymbol = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_X, 13, outline, red);
            this.chartLocationGraphic = new Graphic(null, chartLocationSymbol); // RED X //
            this.map.graphics.add(this.chartLocationGraphic);
          }

          // SET GEOMETRY OF LOCATION GRAPHIC //
          var distanceIndex = (this.distances) ? array.indexOf(this.distances, chartObjectX) : -1;
          if (distanceIndex >= 0) {
            var elevData = this.elevationData[distanceIndex];
            this.chartLocationGraphic.setGeometry(this.profilePolyline.getPoint(elevData.pathIdx, elevData.pointIdx));
          } else {
            this.chartLocationGraphic.setGeometry(null);
          }
        }
      },

      /**
       * GET DISPLAY VALUE GIVEN A VALUE IN METERS AND THE DISPLAY UNITS
       * CONVERT FROM METERS TO MILES THEN FROM MILES TO DISPLAY UNITS
       *
       * @param {Number} valueMeters
       * @param {String} displayUnits
       */
      _getDisplayValue: function (valueMeters, displayUnits) {
        if (displayUnits === this.measureTool._unitStrings.esriMeters) {
          return valueMeters;
        } else {
          var distanceMiles = (valueMeters * this.measureTool._unitDictionary[this.measureTool._unitStrings.esriMeters]);
          return (distanceMiles / this.measureTool._unitDictionary[displayUnits]);
        }
      },

      /**
       * GET DISPLAY UNITS
       *
       * @param {Boolean} isElevation
       */
      _getDisplayUnits: function (isElevation) {
        var displayUnits = this.measureTool._unitDropDown.label;
        if (isElevation) {
          switch (displayUnits) {
          case this.measureTool._unitStrings.esriMiles:
            displayUnits = this.measureTool._unitStrings.esriFeet;
            break;
          case this.measureTool.esriYards:
            displayUnits = this.measureTool._unitStrings.esriYards;
            break;
          case this.measureTool._unitStrings.esriKilometers:
            displayUnits = this.measureTool._unitStrings.esriMeters;
            break;
          }
        }
        return displayUnits;
      },

      /**
       * CONVERT ELEVATION INFO (X=DISTANCE,Y=ELEVATION) FROM METERS TO DISPLAY UNITS
       *
       * @param elevationArray
       * @returns {Array}
       * @private
       */
      _convertElevationsInfoArray: function (elevationArray) {
        var displayUnitsX = this._getDisplayUnits(false);
        var displayUnitsY = this._getDisplayUnits(true);
        return array.map(elevationArray, lang.hitch(this, function (item) {
          return lang.mixin(item, {
            x: this._getDisplayValue(item.x, displayUnitsX),
            y: this._getDisplayValue(item.y, displayUnitsY)
          });
        }));
      },

      /**
       * CONVERT DISTANCES FROM METERS TO DISPLAY UNITS
       *
       * @param distancesArray
       * @returns {Array}
       * @private
       */
      _convertDistancesArray: function (distancesArray) {
        var displayUnitsX = this._getDisplayUnits(false);
        return array.map(distancesArray, lang.hitch(this, function (distance) {
          return this._getDisplayValue(distance, displayUnitsX);
        }));
      },

      /**
       * CREATE ARRAY WITH INPUT VALUE AND ALLOW MULTIPLIER
       *
       * @param size
       * @param value
       * @param asMultiplier
       * @returns {Array}
       * @private
       */
      _getFilledArray: function (size, value, asMultiplier) {
        var dataArray = new Array(size);
        for (var dataIdx = 0; dataIdx < size; ++dataIdx) {
          dataArray[dataIdx] = {
            x: asMultiplier ? (dataIdx * value) : dataIdx,
            y: asMultiplier ? 0.0 : (value || 0.0)
          };
        }
        return dataArray;
      },

      /**
       * RESET Y VALUES IN ARRAY
       *
       * @param dataArray
       * @param value
       * @returns {*}
       * @private
       */
      _resetArray: function (dataArray, value) {
        return array.map(dataArray, function (item) {
          return {
            x: item.x,
            y: value
          };
        });
      },

      /**
       * GET MAXIMUM Y VALUE IN ARRAY
       *
       * @param {[]} dataArray
       * @return {number}
       * @private
       */
      _getArrayMax: function (dataArray) {
        var values = array.map(dataArray, function (item) {
          return item.y;
        });
        return Math.max.apply(Math, values);
      },

      /**
       * GET MINIMUM Y VALUE IN ARRAY
       *
       * @param {[]} dataArray
       * @return {number}
       * @private
       */
      _getArrayMin: function (dataArray) {
        var values = array.map(dataArray, function (item) {
          return item.y;
        });
        return Math.min.apply(Math, values);
      },

      /**
       * DESTROY DIJIT
       */
      destroy: function () {
        if (this.profileChart) {
          this.profileChart.destroy();
        }
        this.inherited(arguments);
      }
    });
  });
