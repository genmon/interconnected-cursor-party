/*

Stripped-down and adapted Rangy library, using Web API where possible
instead of wrapped Rangy objects

Original: https://github.com/timdown/rangy/ (MIT license)

Ported because

- we only need modern browsers due to requiring the CSS Highlight API
  (the original works to support IE6+, which we don't need)
- there's a lot of other code we're not using
- we want to use Typescript and the standard Web API as much as possible
- the original Rangy loads slowly, and we don't want to have to defer
  loading the Highlights system

Need to port:

- checksum = rangy.getElementChecksum(el)
- range = rangy.deserializeRange(serialized, containerEl)
- ranges = selection.getAllRanges()
- selection.isCollapsed
- rangy.dom.isAncestorOf(el, range.commonAncestorContainer)
- selection = rangy.getSelection
- serialized = rangy.serializeSelection(selection, false [no checksum], containerEl)

*/

/* From rangy/lib/range-serializer.js */

const crc32 = (function () {
  function utf8encode(str: string) {
    var utf8CharCodes = [];

    for (var i = 0, len = str.length, c; i < len; ++i) {
      c = str.charCodeAt(i);
      if (c < 128) {
        utf8CharCodes.push(c);
      } else if (c < 2048) {
        utf8CharCodes.push((c >> 6) | 192, (c & 63) | 128);
      } else {
        utf8CharCodes.push(
          (c >> 12) | 224,
          ((c >> 6) & 63) | 128,
          (c & 63) | 128
        );
      }
    }
    return utf8CharCodes;
  }

  var cachedCrcTable: number[] | null = null;

  function buildCRCTable() {
    var table = [];
    for (var i = 0, j, crc; i < 256; ++i) {
      crc = i;
      j = 8;
      while (j--) {
        if ((crc & 1) == 1) {
          crc = (crc >>> 1) ^ 0xedb88320;
        } else {
          crc >>>= 1;
        }
      }
      table[i] = crc >>> 0;
    }
    return table;
  }

  function getCrcTable() {
    if (!cachedCrcTable) {
      cachedCrcTable = buildCRCTable();
    }
    return cachedCrcTable;
  }

  return function (str: string) {
    var utf8CharCodes = utf8encode(str),
      crc = -1,
      crcTable = getCrcTable();
    for (var i = 0, len = utf8CharCodes.length, y; i < len; ++i) {
      y = (crc ^ utf8CharCodes[i]) & 0xff;
      crc = (crc >>> 8) ^ crcTable[y];
    }
    return (crc ^ -1) >>> 0;
  };
})();

function escapeTextForHtml(str: string) {
  return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function nodeToInfoString(node: Node, infoParts: string[] = []) {
  var nodeType = node.nodeType,
    children = node.childNodes,
    childCount = children.length;
  var nodeInfo = [nodeType, node.nodeName, childCount].join(":");
  var start = "",
    end = "";
  switch (nodeType) {
    case 3: // Text node
      start = escapeTextForHtml(node.nodeValue ?? "");
      break;
    case 8: // Comment
      start = "<!--" + escapeTextForHtml(node.nodeValue ?? "") + "-->";
      break;
    default:
      start = "<" + nodeInfo + ">";
      end = "</>";
      break;
  }
  if (start) {
    infoParts.push(start);
  }
  for (var i = 0; i < childCount; ++i) {
    nodeToInfoString(children[i], infoParts);
  }
  if (end) {
    infoParts.push(end);
  }
  return infoParts;
}

// Creates a string representation of the specified element's contents that is similar to innerHTML but omits all
// attributes and comments and includes child node counts. This is done instead of using innerHTML to work around
// IE <= 8's policy of including element properties in attributes, which ruins things by changing an element's
// innerHTML whenever the user changes an input within the element.
export function getElementChecksum(el: Node): string {
  var info = nodeToInfoString(el).join("");
  return crc32(info).toString(16);
}

// Functions related to deserializing follow

function DomPosition(node: Node, offset: number) {
  return { node, offset };
}
function deserializePosition(
  serialized: string,
  rootNode: Node,
  doc?: Document | null
) {
  if (!rootNode) {
    rootNode = (doc || document).documentElement;
  }
  var parts = serialized.split(":");
  var node = rootNode;
  var nodeIndices = parts[0] ? parts[0].split("/") : [],
    i = nodeIndices.length,
    nodeIndex;

  while (i--) {
    nodeIndex = parseInt(nodeIndices[i], 10);
    if (nodeIndex < node.childNodes.length) {
      node = node.childNodes[nodeIndex];
    } else {
      throw (
        "deserializePosition() failed: node " +
        node +
        " has no child with index " +
        nodeIndex +
        ", " +
        i
      );
    }
  }

  return DomPosition(node, parseInt(parts[1], 10));
}

var deserializeRegex = /^([^,]+),([^,\{]+)(\{([^}]+)\})?$/;

export function deserializeRange(
  serialized: string,
  rootNode: Node,
  doc?: Document | null
) {
  if (rootNode) {
    //doc = doc || dom.getDocument(rootNode);
    doc = doc || rootNode.ownerDocument;
  } else {
    doc = doc || document;
    rootNode = doc.documentElement;
  }
  var result = deserializeRegex.exec(serialized);
  var checksum = result ? result[4] : null;
  if (checksum) {
    var rootNodeChecksum = getElementChecksum(rootNode);
    if (checksum !== rootNodeChecksum) {
      throw (
        "deserializeRange(): checksums of serialized range root node (" +
        checksum +
        ") and target root node (" +
        rootNodeChecksum +
        ") do not match"
      );
    }
  }
  if (!result) {
    throw new Error("deserializeRange(): Error deserializing range");
  }
  var start = deserializePosition(result[1], rootNode, doc),
    end = deserializePosition(result[2], rootNode, doc);
  //var range = api.createRange(doc);
  //range.setStartAndEnd(start.node, start.offset, end.node, end.offset);
  var range = new Range();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

// Related to serializing

export function getAllRangesForSelection(selection: Selection) {
  var ranges = [];
  for (var i = 0, len = selection.rangeCount; i < len; ++i) {
    ranges[i] = selection.getRangeAt(i);
  }
  return ranges;
}

function getNodeIndex(node: Node) {
  var i = 0;
  while (true) {
    if (!node.previousSibling) break;
    node = node.previousSibling;
    ++i;
  }
  return i;
}

function isAncestorOf(
  ancestor: Node,
  descendant: Node,
  selfIsAncestor: boolean = false
) {
  var n = selfIsAncestor ? descendant : descendant.parentNode;
  while (n) {
    if (n === ancestor) {
      return true;
    } else {
      n = n.parentNode;
    }
  }
  return false;
}

export function isOrIsAncestorOf(ancestor: Node, descendant: Node) {
  return isAncestorOf(ancestor, descendant, true);
}

function serializePosition(node: Node, offset: number, rootNode: Node) {
  var pathParts = [];
  var n = node;
  var rootNode = rootNode || node.ownerDocument;
  while (n && n != rootNode) {
    pathParts.push(getNodeIndex(n));
    n = n.parentNode!;
  }
  return pathParts.join("/") + ":" + offset;
}

function serializeRange(range: Range, omitChecksum: boolean, rootNode: Node) {
  rootNode = rootNode || range.startContainer.ownerDocument;
  if (!isOrIsAncestorOf(rootNode, range.commonAncestorContainer)) {
    console.log("THROW");
    throw (
      "serializeRange(): range " +
      range +
      " is not wholly contained within specified root node " +
      rootNode
    );
  }
  var serialized =
    serializePosition(range.startContainer, range.startOffset, rootNode) +
    "," +
    serializePosition(range.endContainer, range.endOffset, rootNode);
  if (!omitChecksum) {
    serialized += "{" + getElementChecksum(rootNode) + "}";
  }
  return serialized;
}

export function serializeSelection(
  selection: Selection,
  omitChecksum: boolean,
  rootNode: Node
) {
  //selection = api.getSelection(selection);
  var ranges = getAllRangesForSelection(selection);
  var serializedRanges = [];
  for (var i = 0, len = ranges.length; i < len; ++i) {
    serializedRanges[i] = serializeRange(ranges[i], omitChecksum, rootNode);
  }
  return serializedRanges.join("|");
}
