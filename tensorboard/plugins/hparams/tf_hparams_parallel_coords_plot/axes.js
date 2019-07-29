/* Copyright 2019 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the 'License');
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an 'AS IS' BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
/* Defines classes that manage the axes in the parallel coordinates plot. */
var tf;
(function (tf) {
    var hparams;
    (function (hparams) {
        var parallel_coords_plot;
        (function (parallel_coords_plot) {
            /**
             * The scale types a column can have. These correspond to the values of
             * options.columns[].scale. See the comments in
             * tf-hparam-scale-and-color-controls.html for more details on the various
             * scale types.
             */
            let ScaleType;
            (function (ScaleType) {
                ScaleType["LINEAR"] = "LINEAR";
                ScaleType["LOG"] = "LOG";
                ScaleType["QUANTILE"] = "QUANTILE";
                ScaleType["NON_NUMERIC"] = "NON_NUMERIC";
            })(ScaleType = parallel_coords_plot.ScaleType || (parallel_coords_plot.ScaleType = {}));
            /**
             * An AlwaysPassingBrushFilter returns 'true' for any value. It is used
             * to represent the case when an Axis does not have an active brush selection.
             */
            class AlwaysPassingBrushFilter {
                isPassing(value) {
                    return true;
                }
            }
            /**
             * An IntervalBrushFilter returns 'true' if the given (numeric) value lies
             * in a given interval specified on construction . It's used to represent
             * brush filters for Axis with linear, logarithmic or quantile scales.
             */
            class IntervalBrushFilter {
                /** Constructs the filter. The interval used is defined by lower, and upper.
                 * If lowerOpen (resp. upperOpen) is true, the interval will be open in
                 * its lower (resp. upper) end, otherwise it will be closed.
                 */
                constructor(lower, upper, lowerOpen, upperOpen) {
                    this._lower = lower;
                    this._upper = upper;
                    this._lowerOpen = lowerOpen;
                    this._upperOpen = upperOpen;
                }
                isPassing(value) {
                    const numValue = value;
                    return this._before(this._lower, numValue, !this._lowerOpen) &&
                        this._before(numValue, this._upper, !this._upperOpen);
                }
                _before(a, b, inclusive) {
                    if (inclusive) {
                        return a <= b;
                    }
                    return a < b;
                }
            }
            /**
             * A SetBrushFilter returns 'true' if the value is in a given set specified
             * in construction.
             */
            class SetBrushFilter {
                constructor(domainSet) {
                    this._domainSet = domainSet;
                }
                isPassing(value) {
                    return this._domainSet.findIndex(element => (element === value)) !== -1;
                }
            }
            /**
             * Represents a single Axis. An axis does not know its horizontal location in
             * the SVG; instead the axes locations are managed by the AxesCollection class.
             * An axis represents a single column (metric or haparam). It stores a scale
             * type and a D3 scale that maps values in the axis domain (column values)
             * to y-coordinates in the SVG. Additionally, an axis stores a
             * D3-brush-selection which is a 2-element numeric array of the form
             * [lower, upper] containing the upper and lower y-coordinates of the current
             * brush selection. If no brush selection exists, the brush selection stored is
             * null.
             * Finally, an axis can be visible (displayed) or invisible (which will be
             * set based on the user's settings for the corresponding column). An invisible
             * axis need not have its scale or scale-type populated.
             */
            class Axis {
                /**
                 * Constructs an axis representing the column indexed by 'colIndex' with
                 * respect to 'schema'. Needs an InteractionManager instance so that it can
                 * call its event handlers upon receiving events from the DOM.
                 */
                constructor(svgProps, schema, interactionManager, colIndex) {
                    this._svgProps = svgProps;
                    this._schema = schema;
                    this._interactionManager = interactionManager;
                    this._colIndex = colIndex;
                    this._isDisplayed = false;
                    this._yScale = null;
                    this._scaleType = null;
                    this.setBrushSelection(null);
                }
                colIndex() {
                    return this._colIndex;
                }
                yScale() {
                    return this._yScale;
                }
                scaleType() {
                    return this._scaleType;
                }
                brushSelection() {
                    return this._brushSelection;
                }
                isDisplayed() {
                    return this._isDisplayed;
                }
                setBrushSelection(brushSelection) {
                    this._brushSelection = brushSelection;
                    this._brushFilter = this._buildBrushFilter(this.brushSelection(), this.scaleType(), this.yScale());
                }
                /**
                 * Sets the domain and scale type for the axis. The current brush selection
                 * is preserved.
                 */
                setDomainAndScale(domainValues, scaleType) {
                    this._scaleType = scaleType;
                    this._yScale = tf.hparams.parallel_coords_plot.createAxisScale(
                    // Pass a copy since createAxisScale may permute the domainValues array.
                    domainValues.slice(), this._svgProps.height, this.scaleType());
                    // TODO(erez): Try to modify the brush selection so that it selects
                    // the same subset of the axis domain which was selected before
                    // this method was called.
                    // This can't always be done (e.g. if we switched from a linear to a
                    // quantile scale, or if the domain values changed significantly) but in
                    // the cases when it is possible, it will be more convenient to the user.
                    // Currently, we keep the same brush selection and recalculate the filter.
                    // Note that this function will be called every time data is reloaded
                    // (e.g. every 30 seconds by default in Tensorboard), so we have to make
                    // sure not to change the selection if the data hasn't changed, as that
                    // would be very annoying to the end user.
                    this._brushFilter = this._buildBrushFilter(this.brushSelection(), this.scaleType(), this.yScale());
                }
                brushFilter() {
                    return this._brushFilter;
                }
                /**
                 * Renders the axis as child elements of 'axisParent'. Removes any preexisting
                 * children of axisParent. 'axisParent' is expected to be a <g> element.
                 */
                updateDOM(axisParent /* HTMLElement */) {
                    let d3Axis = d3.axisLeft(this.yScale());
                    if (this.scaleType() === ScaleType.QUANTILE) {
                        // The default tickValues of a quantile scale is just the
                        // scale domain, which produces overlapping labels if the
                        // number of elements in the domain is greater than the
                        // number of quantiles (since then the scale maps more than
                        // one domain value to the same quantile).
                        d3Axis = d3Axis
                            .tickValues(this.yScale().quantiles())
                            .tickFormat(d3.format("-.6g"));
                    }
                    const axisParentSel = d3.select(axisParent);
                    axisParentSel.selectAll("g").remove();
                    axisParentSel.append("g").classed("axis", true)
                        .call(d3Axis)
                        // Add axis title.
                        .append("text")
                        .classed("axis-title", true)
                        .style("cursor", "move")
                        .style("text-anchor", "middle")
                        .attr("y", -9)
                        .text(colIndex => tf.hparams.utils.schemaColumnName(this._schema, colIndex));
                    // Add dragging event handlers.
                    axisParentSel.call(d3.drag()
                        .on("start", () => {
                        // We set an attribute on the axis that signals
                        // that it is being dragged. This allows
                        // integration tests to know when dragging is done.
                        axisParent.setAttribute("is-dragging", "");
                        this._interactionManager.onDragStart(this.colIndex());
                    })
                        .on("drag", () => this._interactionManager.onDrag(d3.event.x))
                        .on("end", () => {
                        this._interactionManager.onDragEnd();
                        axisParent.removeAttribute("is-dragging");
                    }));
                    // Add the brush.
                    const d3Brush = d3.brushY()
                        .extent([[-8, 0], [8, this._svgProps.height + 1]])
                        /* Define the brush event handlers. D3 will call these both when
                           the user moves the brush selection and when we change the brush
                           selection programmatically using d3Brush.move(). We'd like to
                           avoid calling the interactionManager in the latter case; thus,
                           we call _isInteractiveD3Event() to find out if the event was fired
                           due to a programmetic change of the brush selection , and if so,
                           ignore the event. */
                        .on("start", () => {
                        if (!_isInteractiveD3Event(d3.event)) {
                            return;
                        }
                        // We set the 'is-brushing' attribute on the containing
                        // 'axis-parent'-classed <g> element to notify integration tests
                        // that the axis is busy brushing.
                        axisParent.setAttribute("is-brushing", "");
                        this._interactionManager.onBrushChanged(this.colIndex(), d3.event.selection);
                    })
                        .on("brush", () => {
                        if (!_isInteractiveD3Event(d3.event)) {
                            return;
                        }
                        this._interactionManager.onBrushChanged(this.colIndex(), d3.event.selection);
                    })
                        .on("end", () => {
                        if (!_isInteractiveD3Event(d3.event)) {
                            return;
                        }
                        this._interactionManager.onBrushChanged(this.colIndex(), d3.event.selection);
                        axisParent.removeAttribute("is-brushing");
                    });
                    const brushG = d3.select(axisParent)
                        .append("g")
                        .classed("brush", true);
                    brushG.call(d3Brush);
                    // Set the brush selection programmatically.
                    // We need to cast brushG to 'any' here since TypeScript doesn't realize
                    // the brushG is a <g> selection and complains.
                    d3Brush.move(brushG, this.brushSelection());
                }
                setDisplayed(value) {
                    this._isDisplayed = value;
                }
                /**
                 * @return the brush filter for the given selection using the current
                 * scale.
                 */
                _buildBrushFilter(brushSelection, scaleType, yScale /* D3 scale */) {
                    if (brushSelection === null) {
                        return new AlwaysPassingBrushFilter();
                    }
                    if (scaleType === null) {
                        console.error("Scale type is null, but brushSelection isn't: ", brushSelection);
                        return new AlwaysPassingBrushFilter();
                    }
                    switch (scaleType) {
                        case ScaleType.LINEAR:
                        case ScaleType.LOG: { /* Fall Through */
                            const [lower, upper] = tf.hparams.parallel_coords_plot.continuousScaleInverseImage(yScale, brushSelection[0], brushSelection[1]);
                            return new IntervalBrushFilter(lower, upper, 
                            /*lowerOpen=*/ false, 
                            /*upperOpen=*/ false);
                        }
                        case ScaleType.QUANTILE: {
                            const [lower, upper] = tf.hparams.parallel_coords_plot.quantileScaleInverseImage(yScale, brushSelection[0], brushSelection[1]);
                            return new IntervalBrushFilter(lower, upper, 
                            /*lowerOpen=*/ false, 
                            /*upperOpen=*/ true);
                        }
                        case ScaleType.NON_NUMERIC:
                            return new SetBrushFilter(tf.hparams.parallel_coords_plot.pointScaleInverseImage(yScale, brushSelection[0], brushSelection[1]));
                    }
                    console.error("Unknown scale type: ", scaleType);
                    return new AlwaysPassingBrushFilter();
                }
            }
            parallel_coords_plot.Axis = Axis;
            /**
             * Manages the collection of axes shown in the plot. Has methods that handle
             * dragging an axis and contains the logic for re-ordering the axes
             * during dragging.
             */
            class AxesCollection {
                constructor(svgProps, schema, interactionManager) {
                    this._svgProps = svgProps;
                    this._schema = schema;
                    this._axes = this._createAxes(interactionManager);
                    this._stationaryAxesPositions = d3.scalePoint()
                        .range([1, this._svgProps.width - 1])
                        .padding(0.5);
                    this._draggedAxis = null;
                    this._svgProps.svgG.selectAll("g.axis-parent").remove();
                    this._parentsSel = this._svgProps.svgG.selectAll(".axis-parent");
                }
                /**
                 * Updates all axes based on the given 'options' (see the comments in
                 * tf-hparams-scale-and-color-controls.html) and sessionGroups. SessionGroups
                 * are used to update the domain (and thus scale) of the axes. The 'options'
                 * object control which axes are visible.
                 */
                updateAxes(options, sessionGroups) {
                    console.assert(!this.isAxisDragging());
                    // Traverse options.columns, and update each corresponding axis.
                    const visibleColIndices = new Set();
                    options.columns.forEach(column => {
                        const colIndex = column.absoluteIndex;
                        let axis = this._axes[colIndex];
                        axis.setDisplayed(true);
                        const domainValues = sessionGroups.map(sg => tf.hparams.utils.columnValueByIndex(this._schema, sg, colIndex));
                        axis.setDomainAndScale(domainValues, column.scale);
                        visibleColIndices.add(colIndex);
                    });
                    // Set the visibility of the remaining axes to false.
                    this._axes.forEach(axis => {
                        if (!visibleColIndices.has(axis.colIndex())) {
                            axis.setDisplayed(false);
                        }
                    });
                    this._updateStationaryAxesPositions(visibleColIndices);
                    // Update the DOM.
                    this._parentsSel = this._parentsSel
                        .data(Array.from(visibleColIndices), /*key=*/ (colIndex => colIndex));
                    this._parentsSel.exit().remove();
                    this._parentsSel = this._parentsSel.enter()
                        .append("g")
                        .classed("axis-parent", true)
                        .merge(this._parentsSel);
                    const _this = this;
                    this._parentsSel
                        .call(sel => this._updateAxesPositionsInDOM(sel))
                        .each(function (colIndex) {
                        /* Here 'this' is the 'axis-parent'-classed <g> element,
                           and '_this' is the AxesCollection element. */
                        _this._axes[colIndex].updateDOM(this);
                    });
                }
                /**
                 * Executes mapFunction on each visible axis. Returns an array containing the
                 * result from each invocation. The function is invoked on the axes ordered
                 * by their increasing xPosition.
                 */
                mapVisibleAxes(mapFunction) {
                    return this._stationaryAxesPositions.domain().map(colIndex => mapFunction(this.getAxisPosition(colIndex), this._axes[colIndex]));
                }
                /**
                 * @return true if the given predicate returns true on every visible axis,
                 *     false otherwise. Note that the predicate will only be evaluated until
                 *     the first time it returns false.
                 */
                allVisibleAxesSatisfy(predicate) {
                    return this._stationaryAxesPositions.domain().every(colIndex => predicate(this.getAxisPosition(colIndex), this._axes[colIndex]));
                }
                getAxisForColIndex(colIndex) {
                    return this._axes[colIndex];
                }
                /* Axis dragging.
                 * To drag an axis, call: dragStart(), followed by one or more drag() calls
                 * followed by a single call to dragEnd().
                 * At most one axis can be dragged at any given time.
                 * Each axis (whether dragged or not) has an associated "stationary"
                 * position which is its (x-coordinate) position when it is not being dragged.
                 * The actual position of an axis is either its associated stationary
                 * position if its not dragged or its currently dragged position. This class
                 * maintains the invariant that the axes' stationary positions match the order
                 * of their actual position by re-assigning stationary positions to axes when
                 * dragging an axis causes it to "pass" another axes.
                 */
                dragStart(colIndex) {
                    console.assert(!this.isAxisDragging());
                    console.assert(this._axes[colIndex].isDisplayed());
                    this._draggedAxis = this._axes[colIndex];
                    this._draggedAxisPosition = this._stationaryAxesPositions(colIndex);
                }
                drag(newX) {
                    newX = Math.min(Math.max(newX, 0), this._svgProps.width);
                    this._draggedAxisPosition = newX;
                    let visibleColIndices = this._stationaryAxesPositions.domain();
                    visibleColIndices.sort((ci1, ci2) => this.getAxisPosition(ci1) - this.getAxisPosition(ci2));
                    this._stationaryAxesPositions.domain(visibleColIndices);
                    this._updateAxesPositionsInDOM(this._parentsSel);
                }
                dragEnd(duration) {
                    console.assert(this.isAxisDragging());
                    this._draggedAxisPosition = null;
                    this._draggedAxis = null;
                    this._updateAxesPositionsInDOM(this._parentsSel.transition().duration(duration));
                }
                isAxisDragging() {
                    return this._draggedAxis !== null;
                }
                getAxisPosition(colIndex) {
                    return (this._draggedAxis !== null) &&
                        (this._draggedAxis.colIndex() === colIndex)
                        ? this._draggedAxisPosition
                        : this._stationaryAxesPositions(colIndex);
                }
                /**
                 * Sets the domain of 'stationaryAxesPositions' to be precisely the given
                 * visibleColIndices, but preserves the order of the column indices that
                 * are already in the domain. Essentially, this method removes indices in
                 * the domain that are not in visibleColIndices and then appends indices in
                 * visibleColIndices that are not currently in the domain. Thus, indices in
                 * visibleColIndices that are already in stationaryAxesPositions
                 * will maintain their order in stationaryAxesPositions and will precede
                 * the new elements.
                 *
                 * This reassigns stationary positions to axes so that the only visible
                 * axes are the ones with column indices in 'visibleColIndices', but preserves
                 * the order of axes indexed by visibleColIndices that are already visible.
                 */
                _updateStationaryAxesPositions(visibleColIndices) {
                    const visibleDomain = this._stationaryAxesPositions.domain().filter(colIndex => visibleColIndices.has(colIndex));
                    const newDomain = Array.from(new Set([
                        ...visibleDomain, ...Array.from(visibleColIndices)
                    ]));
                    this._stationaryAxesPositions.domain(newDomain);
                }
                _updateAxesPositionsInDOM(selectionOrTransition) {
                    selectionOrTransition.attr("transform", colIndex => tf.hparams.utils.translateStr(this.getAxisPosition(colIndex)));
                }
                _createAxes(interactionManager) {
                    return d3.range(tf.hparams.utils.numColumns(this._schema)).map(colIndex => new Axis(this._svgProps, this._schema, interactionManager, colIndex));
                }
            }
            parallel_coords_plot.AxesCollection = AxesCollection;
            function _isInteractiveD3Event(d3Event) {
                return d3Event.sourceEvent !== null;
            }
        })(parallel_coords_plot = hparams.parallel_coords_plot || (hparams.parallel_coords_plot = {}));
    })(hparams = tf.hparams || (tf.hparams = {}));
})(tf || (tf = {})); // namespace tf.hparams.parallel_coords_plot