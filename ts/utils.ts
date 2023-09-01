import type {ComfyApp} from './typings/comfy';
import {Vector2, LGraphCanvas as TLGraphCanvas, ContextMenuItem, LLink, LGraph, IContextMenuOptions, ContextMenu, LGraphNode as TLGraphNode, LiteGraph as TLiteGraph} from './typings/litegraph.js';
// @ts-ignore
import {api} from '../../scripts/api.js';

/**
 * Override the api.getNodeDefs call to add a hook for refreshing node defs.
 * This is necessary for power prompt's custom combos. Since API implements
 * add/removeEventListener already, this is rather trivial.
 */
const oldApiGetNodeDefs = api.getNodeDefs;
api.getNodeDefs = async function() {
  const defs = await oldApiGetNodeDefs.call(api);
  this.dispatchEvent(new CustomEvent('fresh-node-defs', { detail: defs }));
  return defs;
}

declare const LGraphNode: typeof TLGraphNode;
declare const LiteGraph: typeof TLiteGraph;

enum IoDirection {
  INPUT,
  OUTPUT,
}

const PADDING = 0;

type LiteGraphDir = typeof LiteGraph.LEFT | typeof LiteGraph.RIGHT | typeof LiteGraph.UP | typeof LiteGraph.DOWN;
export const LAYOUT_LABEL_TO_DATA : {[label: string]: [LiteGraphDir, Vector2, Vector2]} = {
  'Left':  [LiteGraph.LEFT,  [0, 0.5], [PADDING, 0]],
  'Right': [LiteGraph.RIGHT, [1, 0.5], [-PADDING, 0]],
  'Top':   [LiteGraph.UP,    [0.5, 0], [0, PADDING]],
  'Bottom': [LiteGraph.DOWN,  [0.5, 1], [0, -PADDING]],
};
const OPPOSITE_LABEL : {[label: string]: string} = {
  'Left':'Right',
  'Right':'Left',
  'Top':'Bottom',
  'Bottom':'Top',
}

interface MenuConfig {
  name: string | ((node: TLGraphNode) => string);
  property?: string;
  prepareValue?: (value: string, node: TLGraphNode) => any;
  callback?: (node: TLGraphNode) => void;
}

interface SubMenuConfig extends MenuConfig {
  options: string[],
}

export function addMenuItem(node: typeof LGraphNode, _app: ComfyApp, config: MenuConfig) {
  const oldGetExtraMenuOptions = node.prototype.getExtraMenuOptions;
  node.prototype.getExtraMenuOptions = function(canvas: TLGraphCanvas, menuOptions: ContextMenuItem[]) {
    oldGetExtraMenuOptions && oldGetExtraMenuOptions.apply(this, [canvas, menuOptions]);
    const idx = menuOptions.findIndex(option => option?.content.includes('Shape')) + 1;
    menuOptions.splice((idx > 0 ? idx : menuOptions.length - 1), 0, {
      content: typeof config.name == 'function' ? config.name(this) : config.name,
      callback: (_value: ContextMenuItem, _options: IContextMenuOptions, _event: MouseEvent, _parentMenu: ContextMenu | undefined, _node: TLGraphNode) => {
        if (config.property) {
          this.properties = this.properties || {};
          this.properties[config.property] = config.prepareValue ? config.prepareValue(this.properties[config.property], this) : !this.properties[config.property];
        }
        config.callback && config.callback(this);
      }
    });
  };
}


export function addMenuSubMenu(node: typeof LGraphNode, _app: ComfyApp, config: SubMenuConfig) {
  const oldGetExtraMenuOptions = node.prototype.getExtraMenuOptions;
  node.prototype.getExtraMenuOptions = function(canvas: TLGraphCanvas, menuOptions: ContextMenuItem[]) {
    oldGetExtraMenuOptions && oldGetExtraMenuOptions.apply(this, [canvas, menuOptions]);
    const idx = menuOptions.findIndex(option => option?.content.includes('Shape')) + 1;
    menuOptions.splice((idx > 0 ? idx : menuOptions.length - 1), 0, {
      content: typeof config.name == 'function' ? config.name(this) : config.name,
      has_submenu: true,
      callback: (_value: ContextMenuItem, _options: IContextMenuOptions, event: MouseEvent, parentMenu: ContextMenu | undefined, _node: TLGraphNode) => {
        new LiteGraph.ContextMenu(
          config.options.map(option => ({content: option})),
          {
            event,
            parentMenu,
            callback: (value: ContextMenuItem, _options: IContextMenuOptions, _event: MouseEvent, _parentMenu: ContextMenu | undefined, _node: TLGraphNode) => {
              if (config.property) {
                this.properties = this.properties || {};
                this.properties[config.property] = config.prepareValue ? config.prepareValue(value!.content, this) : value!.content;
              }
              config.callback && config.callback(this);
            },
          });
      }
    });
  }
}

export function addConnectionLayoutSupport(node: typeof LGraphNode, app: ComfyApp, options = [['Left', 'Right'], ['Right', 'Left']], callback?: (node: TLGraphNode) => void) {
  addMenuSubMenu(node, app, {
    name: 'Connections Layout',
    property: 'connections_layout',
    options: options.map(option => option[0] + (option[1] ? ' -> ' + option[1]: '')),
    prepareValue: (value, node) => {
      const values = value.split(' -> ');
      if (!values[1] && !node.outputs?.length) {
        values[1] = OPPOSITE_LABEL[values[0]!]!;
      }
      if (!LAYOUT_LABEL_TO_DATA[values[0]!] || !LAYOUT_LABEL_TO_DATA[values[1]!]) {
        throw new Error(`New Layout invalid: [${values[0]}, ${values[1]}]`);
      }
      return values;
    },
    callback: (node) => {
      callback && callback(node);
      app.graph.setDirtyCanvas(true, true);
    },
  })

  // const oldGetConnectionPos = node.prototype.getConnectionPos;
  node.prototype.getConnectionPos = function(isInput: boolean, slotNumber: number, out: Vector2) {
    // Purposefully do not need to call the old one.
    // oldGetConnectionPos && oldGetConnectionPos.apply(this, [isInput, slotNumber, out]);
    return getConnectionPosForLayout(this, isInput, slotNumber, out);
  }
}

export function setConnectionsLayout(node: TLGraphNode, newLayout: [string, string] = ['Left', 'Right']) {
  // If we didn't supply an output layout, and there's no outputs, then just choose the opposite of the
  // input as a safety.
  if (!newLayout[1] && !node.outputs?.length) {
    newLayout[1] = OPPOSITE_LABEL[newLayout[0]!]!;
  }
  if (!LAYOUT_LABEL_TO_DATA[newLayout[0]] || !LAYOUT_LABEL_TO_DATA[newLayout[1]]) {
    throw new Error(`New Layout invalid: [${newLayout[0]}, ${newLayout[1]}]`);
  }
  node.properties = node.properties || {};
  node.properties['connections_layout'] = newLayout;
}

/** Allows collapsing of connections into one. Pretty unusable, unless you're the muter. */
export function setConnectionsCollapse(node: TLGraphNode, collapseConnections: boolean | null = null) {
  node.properties = node.properties || {};
  collapseConnections = collapseConnections !== null ? collapseConnections : !node.properties['collapse_connections'];
  node.properties['collapse_connections'] = collapseConnections;
}

export function getConnectionPosForLayout(node: TLGraphNode, isInput: boolean, slotNumber: number, out: Vector2) {
  out = out || new Float32Array(2);
  node.properties = node.properties || {};
  const layout = node.properties['connections_layout'] || ['Left', 'Right'];
  const collapseConnections = node.properties['collapse_connections'] || false;
  const offset = (node.constructor as any).layout_slot_offset ?? (LiteGraph.NODE_SLOT_HEIGHT * 0.5);
  let side = isInput ? layout[0] : layout[1];
  const otherSide = isInput ? layout[1] : layout[0];
  const data = LAYOUT_LABEL_TO_DATA[side]!;
  const slotList = node[isInput ? 'inputs' : 'outputs'];
  const cxn = slotList[slotNumber];
  if (!cxn) {
    console.log('No connection found.. weird', isInput, slotNumber);
    return out;
  }
  // Experimental; doesn't work without node.clip_area set (so it won't draw outside),
  // but litegraph.core inexplicably clips the title off which we want... so, no go.
  // if (cxn.hidden) {
  //   out[0] = node.pos[0] - 100000
  //   out[1] = node.pos[1] - 100000
  //   return out
  // }
  if (cxn.disabled) {
    // Let's store the original colors if have them and haven't yet overridden
    if (cxn.color_on !== '#666665') {
      (cxn as any)._color_on_org = (cxn as any)._color_on_org || cxn.color_on;
      (cxn as any)._color_off_org = (cxn as any)._color_off_org || cxn.color_off;
    }
    cxn.color_on = '#666665';
    cxn.color_off = '#666665';
  } else if (cxn.color_on === '#666665') {
    cxn.color_on = (cxn as any)._color_on_org || undefined;
    cxn.color_off = (cxn as any)._color_off_org || undefined;
  }
  // @ts-ignore
  const displaySlot = collapseConnections ? 0 : (slotNumber - slotList.reduce<Number>((count, ioput, index) => {
    count += index < slotNumber && ioput.hidden ? 1 : 0;
    return count
  }, 0));
  // Set the direction first. This is how the connection line will be drawn.
  cxn.dir = data[0];
  // If we are only 10px wide or tall, then put it one the end
  if (node.size[0] == 10 && ['Left', 'Right'].includes(side) && ['Top', 'Bottom'].includes(otherSide)) {
    side = otherSide === 'Top' ? 'Bottom' : 'Top';
  } else if (node.size[1] == 10 && ['Top', 'Bottom'].includes(side) && ['Left', 'Right'].includes(otherSide)) {
    side = otherSide === 'Left' ? 'Right' : 'Left';
  }
  if (side === 'Left') {
    if (node.flags.collapsed) {
      var w = (node as any)._collapsed_width || LiteGraph.NODE_COLLAPSED_WIDTH;
      out[0] = node.pos[0];
      out[1] = node.pos[1] - LiteGraph.NODE_TITLE_HEIGHT * 0.5;
    } else {
      // If we're an output, then the litegraph.core hates us; we need to blank out the name
      // because it's not flexible enough to put the text on the inside.
      if (!isInput && !(cxn as any).has_old_label) {
        (cxn as any).has_old_label = true;
        (cxn as any).old_label = cxn.label;
        cxn.label = ' ';
      } else if (isInput && (cxn as any).has_old_label) {
        (cxn as any).has_old_label = false;
        cxn.label = (cxn as any).old_label;
        (cxn as any).old_label = undefined;
      }
      out[0] = node.pos[0] + offset;
      if ((node.constructor as any)?.type.includes('Reroute')) {
        out[1] = node.pos[1] + (node.size[1] * .5);
      } else {
        out[1] =
            node.pos[1] +
            (displaySlot + 0.7) * LiteGraph.NODE_SLOT_HEIGHT +
            ((node.constructor as any).slot_start_y || 0);
      }
    }

  } else if (side === 'Right') {
    if (node.flags.collapsed) {
      var w = (node as any)._collapsed_width || LiteGraph.NODE_COLLAPSED_WIDTH;
      out[0] = node.pos[0] + w;
      out[1] = node.pos[1] - LiteGraph.NODE_TITLE_HEIGHT * 0.5;
    } else {
      // If we're an input, then the litegraph.core hates us; we need to blank out the name
      // because it's not flexible enough to put the text on the inside.
      if (isInput && !(cxn as any).has_old_label) {
        (cxn as any).has_old_label = true;
        (cxn as any).old_label = cxn.label;
        cxn.label = ' ';
      } else if (!isInput && (cxn as any).has_old_label) {
        (cxn as any).has_old_label = false;
        cxn.label = (cxn as any).old_label;
        (cxn as any).old_label = undefined;
      }
      out[0] = node.pos[0] + node.size[0] + 1 - offset;
      if ((node.constructor as any)?.type.includes('Reroute')) {
        out[1] = node.pos[1] + (node.size[1] * .5);
      } else {
        out[1] =
            node.pos[1] +
            (displaySlot + 0.7) * LiteGraph.NODE_SLOT_HEIGHT +
            ((node.constructor as any).slot_start_y || 0);
      }
    }

  // Right now, only reroute uses top/bottom, so this may not work for other nodes
  // (like, applying to nodes with titles, collapsed, multiple inputs/outputs, etc).
  } else if (side === 'Top') {
    if (!(cxn as any).has_old_label) {
      (cxn as any).has_old_label = true;
      (cxn as any).old_label = cxn.label;
      cxn.label = ' ';
    }
    out[0] = node.pos[0] + (node.size[0] * .5);
    out[1] = node.pos[1] + offset;


  } else if (side === 'Bottom') {
    if (!(cxn as any).has_old_label) {
      (cxn as any).has_old_label = true;
      (cxn as any).old_label = cxn.label;
      cxn.label = ' ';
    }
    out[0] = node.pos[0] + (node.size[0] * .5);
    out[1] = node.pos[1] + node.size[1] - offset;

  }
  return out;
}

export function wait(ms = 16, value?: any) {
  return new Promise((resolve) => {
    setTimeout(() => { resolve(value); }, ms);
  });
}


export function addHelp(node: typeof LGraphNode, app: ComfyApp) {
  const help = (node as any).help as string;
  if (help) {
    addMenuItem(node, app, {
        name: '🛟 Node Help',
        property: 'help',
        callback: (_node) => { alert(help); }
    });
  }
}


/**
 * Determines if, when doing a chain lookup for connected nodes, we want to pass through this node,
 * like reroutes, etc.
 */
export function isPassThroughType(node: TLGraphNode|null) {
  const type = (node?.constructor as typeof TLGraphNode)?.type;
  return type?.includes('Reroute')
      || type?.includes('Node Combiner')
      || type?.includes('Node Collector');
}

/**
 * Looks through the immediate chain of a node to collect all connected nodes, passing through nodes
 * like reroute, etc. Will also disconnect duplicate nodes from a provided node
 */
export function getConnectedInputNodes(app: ComfyApp, startNode: TLGraphNode, currentNode?: TLGraphNode) {
  return getConnectedNodes(app, startNode, IoDirection.INPUT, currentNode);
}

export function getConnectedOutputNodes(app: ComfyApp, startNode: TLGraphNode, currentNode?: TLGraphNode) {
  return getConnectedNodes(app, startNode, IoDirection.OUTPUT, currentNode);
}


function getConnectedNodes(app: ComfyApp, startNode: TLGraphNode, dir = IoDirection.INPUT, currentNode?: TLGraphNode) {
  currentNode = currentNode || startNode;
  let rootNodes: TLGraphNode[] = [];
  const slotsToRemove = [];
  if (startNode === currentNode || isPassThroughType(currentNode)) {
    const removeDups = startNode === currentNode;
    let linkIds: Array<number|null>;
    if (dir == IoDirection.OUTPUT) {
      linkIds = currentNode.outputs?.flatMap(i => i.links);
    } else {
      linkIds = currentNode.inputs?.map(i => i.link);
    }
    let graph = app.graph as LGraph;
    for (const linkId of linkIds) {
      if (!linkId) {
        continue;
      }
      const link: LLink = graph.links[linkId]!;
      const connectedId = dir == IoDirection.OUTPUT ? link.target_id : link.origin_id;
      const originNode: TLGraphNode = graph.getNodeById(connectedId)!;
      if (isPassThroughType(originNode)) {
        for (const foundNode of getConnectedNodes(app, startNode, dir, originNode)) {
          if (!rootNodes.includes(foundNode)) {
            rootNodes.push(foundNode);
          }
        }
      } else if (rootNodes.includes(originNode)) {
        const connectedSlot = dir == IoDirection.OUTPUT ? link.origin_slot : link.target_slot;
        removeDups && (slotsToRemove.push(connectedSlot))
      } else {
        rootNodes.push(originNode);
      }
    }
    for (const slot of slotsToRemove) {
      if (dir == IoDirection.OUTPUT) {
        startNode.disconnectOutput(slot);
      } else {
        startNode.disconnectInput(slot);
      }
    }
  }
  return rootNodes;
}
