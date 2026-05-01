# Link: Project interaction tracker

## Intro

The general goal for this project is to create a graph-backed database to track and retrieve the "links" (hence the name, *Link*) between entities in a work-related environment.

For instance, users would like to track who is working on which team, what projects are there, who is related to which one, which technologies are there, who knows about the technologies, product groups related to them, etc...

The main goal is to provide a way to inteact with the graph both via API first and then an MCP server that leverages that API, so agents can read and modify the graph, and also via a web client, that uses the same API.

The 2 main ways of interacting with it will be:
- fully deterministic access via the API + web ui: the users will be able to create/edit nodes, link them, edit the links, create/edit the types of links, etc. Basically, manipulate the whole graph, on a node by node, link by link basis. The web ui should live-refresh changes to the graph as they happen (most likely, with a websocket) and the user should be able to browse the graph in some kind of map (there's probably an existing library to do that in javascript/typescript)

- access via agents with Skills and MCP server: the users should use an agent with a Link skill and an MCP server to say things like "show me all the contacts we have related to the xyz project", or "add john doe as a TeamX member, and mark him as an expert in tech123". With this, the agent should know how to retrieve the whole graph (it will be small enough to fit in the agent's context for sure), search for info about a specific node with some fuzzy search, and use that to let the user interact with the graph. Most likely, the skill will have to explain step by step how to do things (like, first ask for the whole graph, then use the tool to search for something, if need to update the graph use the other tools, etc. This is just an example, not a spec!). In general, before modifying the graph, it should ask for confirmation to the user, showing which exact modifications it will do.

## General feature ideas

Here is a list with several ideas that I want to incorporate to the project, in no particular order. Some of the ideas/requirements might be duplicated. It was mostly a brain dump:

- graph database. I don't have any preference on how to store it, but it needs to be something simple enough so I can use it both locally without extra dependencies, and eventually deploy it to azure and have concurrent users using it. Keep it as simple as possible. Also, if there's something that can fit this, use a library that's proven already. The amount of raw data should be small enough. This is for a single team, so the amount of nodes will most likely be around the 100s - 1000s, not more.

- Example of what entities can be, based on my current needs. However, this needs to be 100% flexible:
    - Product Group
    - Person
    - Product
    - Issue
    - Technology 
    - Org
    - Customer
    - Project
    - Team
    - Other
    - Info (status with date. For instance, an status update on a project or an issue)
    - AKA (aliases for people, products, etc)
- dynamic type of entities. The users can decide to add/remove types. When interacting via the agent, it should be able to suggest new type of entities and links if the right fit doesn't exist yet.
- Not sure how to track changes, but ideally we should be able to go forward and backward in time in the graph, on each modification. Just to see how it evolved. In general, the users only interact with the latest version of the graph.
- Each link between nodes can have a dynamic name, but in general we should aim for consistency (reuse existing terminology instead of adding new when possible) 
- Links can be directional or bidirectional 
- Most likely, when using the agent you should be able to load the whole graph in context when starting or right after an update, since it will be small enough. 
- When using the agent, fuzzy search the entities required in the query and show specifically the direct connections they have, in addition to retrieving the whole graph.
- When asking the agent about status of something, it should know what happened based on the latest graph updates and tell you 
- Allow manual creation/edition/deletion of nodes and connections
- This app is fully deterministic. When the user interacts via an agent, it should have a skill to explain how to use the API/MCP server and you interact with it via the agent
- The ui should show the nodes and connections, let you navigate  through the graph, add/edit/remove nodes and connections based on the allowed types, add/edit/remive types. Saves should be done automatically every time a change is made to avoid concurrency issues. Every time the graph is updated, it must make sure it's changing the latest version of the graph, to avoid concurrency issues.
- The live state in the web ui should be maintained via a websocket or something like that to support concurrent users editing and viewing. 
- Should be either no auth at all (single user or localhost or development) or auth via entraID (this could be added in the future, but let's make sure that we'll support multiple users)
- API and MCP server should be no auth at all (like the webui or api for single user, localhost or dev) or entraID auth (same as previous line)
- This should be multi user and be able to scale horizontally, at least the compute part. We can rely on a single data source
