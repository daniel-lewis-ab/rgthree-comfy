// / <reference path="../node_modules/litegraph.js/src/litegraph.d.ts" />
// @ts-ignore
import { app } from "../../scripts/app.js";
import type {INodeInputSlot, INodeOutputSlot, LGraphNode, LLink, LiteGraph as TLiteGraph,} from './typings/litegraph.js';
import { addConnectionLayoutSupport, addHelp, getConnectedInputNodes, getConnectedOutputNodes, wait} from "./utils.js";
// @ts-ignore
import { ComfyWidgets } from "../../scripts/widgets.js";
// @ts-ignore
import { BaseCollectorNode } from './base_node_collector.js';
import { NodeMode } from "./typings/comfy.js";
import { NodeTypesString, stripRgthree } from "./constants.js";

declare const LiteGraph: typeof TLiteGraph;

const MODE_ALWAYS = 0;
const MODE_MUTE = 2;
const MODE_BYPASS = 4;
const MODE_REPEATS = [MODE_MUTE, MODE_BYPASS];


class NodeModeRelay extends BaseCollectorNode {

  static override type = NodeTypesString.NODE_MODE_RELAY;
  static override title = NodeTypesString.NODE_MODE_RELAY;

  static help = [
    `This node will relay its input nodes' modes (Mute, Bypass, or Active) to a connected`,
    `${stripRgthree(NodeTypesString.NODE_MODE_REPEATER)} (which would then repeat that mode change to all of its inputs).`,
    `\n`,
    `\n- When all connected input nodes are muted, the relay will set a connected repeater to mute.`,
    `\n- When all connected input nodes are bypassed, the relay will set a connected repeater to bypass.`,
    `\n- When any connected input nodes are active, the relay will set a connected repeater to active.`,
  ].join(' ');

  constructor(title?: string) {
    super(title);

    setTimeout(() => { this.stabilize(); }, 500);
    this.removeOutput(0);
    this.addOutput('REPEATER', '_NODE_REPEATER_', {
      color_on: '#Fc0',
      color_off: '#a80',
      shape: LiteGraph.ARROW_SHAPE,
    });
  }

  override onConnectOutput(outputIndex: number, inputType: string | -1, inputSlot: INodeInputSlot, inputNode: LGraphNode, inputIndex: number): boolean {
    let canConnect = true;
    if (super.onConnectOutput) {
      canConnect = super.onConnectOutput?.(outputIndex, inputType, inputSlot, inputNode, inputIndex);
    }
    let nextNode = getConnectedOutputNodes(app, this, inputNode)[0] ?? inputNode;
    return canConnect && nextNode.type === NodeTypesString.NODE_MODE_REPEATER;
  }

  override onConnectionsChange(type: number, slotIndex: number, isConnected: boolean, link_info: LLink, ioSlot: INodeOutputSlot | INodeInputSlot): void {
    super.onConnectionsChange(type, slotIndex, isConnected, link_info, ioSlot);
    setTimeout(() => { this.stabilize(); }, 500);
  }

  stabilize() {
    // If we aren't connected to a repeater, then theres no sense in checking. And if we are, but
    // have no inputs, then we're also not ready.
    if (!this.graph || !this.isAnyOutputConnected() || !this.isInputConnected(0)) {
      return;
    }
    const inputNodes = getConnectedInputNodes(app, this);
    let mode: NodeMode|null = undefined;
    for (const inputNode of inputNodes) {
      // If we haven't set our mode to be, then let's set it. Otherwise, mode will stick if it
      // remains constant, otherwise, if we hit an ALWAYS, then we'll unmute all repeaters and
      // if not then we won't do anything.
      if (mode === undefined) {
        mode = inputNode.mode;
      } else if (mode === inputNode.mode && MODE_REPEATS.includes(mode)) {
        continue;
      } else if (inputNode.mode === MODE_ALWAYS || mode === MODE_ALWAYS) {
        mode = MODE_ALWAYS;
      } else {
        mode = null;
      }
    }

    if (mode != null) {
      if (this.outputs?.length) {
        const outputNodes = getConnectedOutputNodes(app, this);
        for (const outputNode of outputNodes) {
          outputNode.mode = mode
          wait(16).then(() => {
            outputNode.setDirtyCanvas(true, true);
          });
        }
      }
    }
    setTimeout(() => { this.stabilize(); }, 500);
  }

}


app.registerExtension({
	name: "rgthree.NodeModeRepeaterHelper",
	registerCustomNodes() {

    addHelp(NodeModeRelay, app);
    addConnectionLayoutSupport(NodeModeRelay, app, [['Left','Right'],['Right','Left']]);

		LiteGraph.registerNodeType(NodeModeRelay.type, NodeModeRelay);
    NodeModeRelay.category = NodeModeRelay._category;
	},
});