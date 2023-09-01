import { app } from "../../scripts/app.js";
import { RgthreeBaseNode } from "./base_node.js";
import { addConnectionLayoutSupport, addMenuItem, getConnectedInputNodes, wait } from "./utils.js";
export class BaseNodeModeChanger extends RgthreeBaseNode {
    constructor(title) {
        super(title);
        this.isVirtualNode = true;
        this.debouncer = 0;
        this.schedulePromise = null;
        this.modeOn = -1;
        this.modeOff = -1;
        wait(10).then(() => {
            if (this.modeOn < 0 || this.modeOff < 0) {
                throw new Error('modeOn and modeOff must be overridden.');
            }
        });
        this.addInput("", "*");
    }
    scheduleStabilizeWidgets() {
        if (!this.schedulePromise) {
            this.schedulePromise = new Promise((resolve) => {
                setTimeout(() => {
                    resolve(this.stabilizeWidgets());
                    this.schedulePromise = null;
                }, 100);
            });
        }
        return this.schedulePromise;
    }
    stabilizeWidgets() {
        if (!this.graph) {
            return;
        }
        const linkedNodes = getConnectedInputNodes(app, this);
        this.stabilizeInputsOutputs();
        for (const [index, node] of linkedNodes.entries()) {
            let widget = this.widgets && this.widgets[index];
            if (!widget) {
                this._tempWidth = this.size[0];
                widget = this.addWidget('toggle', '', false, '', { "on": 'yes', "off": 'no' });
            }
            this.setWidget(widget, node);
        }
        if (this.widgets && this.widgets.length > linkedNodes.length) {
            this._tempWidth = this.size[0];
            this.widgets.length = linkedNodes.length;
        }
        app.graph.setDirtyCanvas(true, true);
        setTimeout(() => { this.stabilizeWidgets(); }, 500);
    }
    setWidget(widget, linkedNode) {
        const off = linkedNode.mode === this.modeOff;
        widget.name = `Enable ${linkedNode.title}`;
        widget.options = { 'on': 'yes', 'off': 'no' };
        widget.value = !off;
        widget.callback = () => {
            const off = linkedNode.mode === this.modeOff;
            linkedNode.mode = (off ? this.modeOn : this.modeOff);
            widget.value = off;
        };
    }
    onConnectionsChainChange() {
        this.scheduleStabilizeWidgets();
    }
    onConnectionsChange(_type, _index, _connected, _linkInfo, _ioSlot) {
        this.scheduleStabilizeWidgets();
    }
    removeInput(slot) {
        this._tempWidth = this.size[0];
        return super.removeInput(slot);
    }
    addInput(name, type, extra_info) {
        this._tempWidth = this.size[0];
        return super.addInput(name, type, extra_info);
    }
    stabilizeInputsOutputs() {
        let hasEmptyInput = false;
        for (let index = this.inputs.length - 1; index >= 0; index--) {
            const input = this.inputs[index];
            if (!input.link) {
                if (index < this.inputs.length - 1) {
                    this.removeInput(index);
                }
                else {
                    hasEmptyInput = true;
                }
            }
        }
        !hasEmptyInput && this.addInput('', '*');
    }
    computeSize(out) {
        var _a, _b;
        let size = super.computeSize(out);
        if (this._tempWidth) {
            size[0] = this._tempWidth;
            this._tempWidth = null;
        }
        if (this.properties['collapse_connections']) {
            const rows = Math.max(((_a = this.inputs) === null || _a === void 0 ? void 0 : _a.length) || 0, ((_b = this.outputs) === null || _b === void 0 ? void 0 : _b.length) || 0, 1) - 1;
            size[1] = size[1] - (rows * LiteGraph.NODE_SLOT_HEIGHT);
        }
        setTimeout(() => {
            app.graph.setDirtyCanvas(true, true);
        }, 16);
        return size;
    }
    static setUp(clazz) {
        addMenuItem(clazz, app, {
            name: 'Refresh',
            callback: (node) => { node.scheduleStabilizeWidgets(); }
        });
        addMenuItem(clazz, app, {
            name: (node) => { var _a; return (`${((_a = node.properties) === null || _a === void 0 ? void 0 : _a['collapse_connections']) ? 'Show' : 'Collapse'} Connections`); },
            property: 'collapse_connections',
            prepareValue: (_value, node) => { var _a; return !((_a = node.properties) === null || _a === void 0 ? void 0 : _a['collapse_connections']); },
            callback: (_node) => { app.graph.setDirtyCanvas(true, true); }
        });
        addConnectionLayoutSupport(clazz, app, [['Left'], ['Right']]);
        LiteGraph.registerNodeType(clazz.type, clazz);
        clazz.category = clazz._category;
    }
}
BaseNodeModeChanger.collapsible = false;
