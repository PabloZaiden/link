import type { EdgeTypeDefinition, NodeTypeDefinition } from "./types";

const timestamp = "1970-01-01T00:00:00.000Z";

export const bootstrapNodeTypes: Omit<NodeTypeDefinition, "createdAt" | "updatedAt">[] = [
  { id: "product-group", name: "Product Group", description: "A product group or business area.", metadataSchema: {} },
  { id: "person", name: "Person", description: "A person or contact.", metadataSchema: { role: { type: "string", label: "Role" } } },
  { id: "product", name: "Product", description: "A product or service.", metadataSchema: {} },
  {
    id: "issue",
    name: "Issue",
    description: "A tracked issue, risk, or blocker.",
    metadataSchema: { status: { type: "enum", label: "Status", options: ["open", "blocked", "resolved"] } },
  },
  { id: "technology", name: "Technology", description: "A technology, framework, service, or platform.", metadataSchema: {} },
  { id: "org", name: "Org", description: "An organization or business unit.", metadataSchema: {} },
  { id: "customer", name: "Customer", description: "A customer or partner.", metadataSchema: {} },
  {
    id: "project",
    name: "Project",
    description: "A project or initiative.",
    metadataSchema: {
      status: { type: "enum", label: "Status", options: ["not-started", "active", "blocked", "done"] },
      targetDate: { type: "date", label: "Target date" },
    },
  },
  { id: "team", name: "Team", description: "A team or working group.", metadataSchema: {} },
  { id: "other", name: "Other", description: "A flexible fallback type.", metadataSchema: {} },
  { id: "info", name: "Info", description: "A dated status update or note.", metadataSchema: { date: { type: "date", label: "Date" } } },
  { id: "aka", name: "AKA", description: "An alias or alternate name.", metadataSchema: {} },
];

export const bootstrapEdgeTypes: Omit<EdgeTypeDefinition, "createdAt" | "updatedAt">[] = [
  { id: "member-of", name: "member of", description: "Connects a person to a team or org.", metadataSchema: {} },
  { id: "owns", name: "owns", description: "Connects an owner to a product, project, or issue.", metadataSchema: {} },
  { id: "works-on", name: "works on", description: "Connects a person or team to a project.", metadataSchema: {} },
  { id: "related-to", name: "related to", description: "General-purpose relationship.", metadataSchema: {} },
  { id: "depends-on", name: "depends on", description: "Dependency relationship.", metadataSchema: {} },
  { id: "knows-about", name: "knows about", description: "Connects a person to a technology or subject.", metadataSchema: {} },
  { id: "alias-of", name: "alias of", description: "Connects an AKA node to its canonical node.", metadataSchema: {} },
  { id: "status-for", name: "status for", description: "Connects an info/status node to the thing it describes.", metadataSchema: {} },
];

export function materializeBootstrapTypes(): {
  nodeTypes: NodeTypeDefinition[];
  edgeTypes: EdgeTypeDefinition[];
} {
  return {
    nodeTypes: bootstrapNodeTypes.map(type => ({ ...type, createdAt: timestamp, updatedAt: timestamp })),
    edgeTypes: bootstrapEdgeTypes.map(type => ({ ...type, createdAt: timestamp, updatedAt: timestamp })),
  };
}
