// Ready-made diagrams to start from. Each is plain DevArt diagram code, so it can be edited like any other diagram.
import type { DiagramType } from './types.ts';

export interface DiagramTemplate {
  id: string;
  name: string;
  description: string;
  type: DiagramType;
  code: string;
}

export const TEMPLATES: DiagramTemplate[] = [
  {
    id: 'microservices',
    name: 'Microservices with API gateway',
    description: 'Clients reach independent services through one gateway; each service owns its data store.',
    type: 'architecture',
    code: `title Microservices
direction right

Web app [icon: globe]
Mobile app [icon: phone]
API Gateway [icon: gateway, color: purple, description: "Auth, routing, rate limits"]
Services [icon: cluster, color: blue] {
  Users service [icon: server]
  Orders service [icon: server]
  Payments service [icon: card]
}
Data [icon: database, color: green] {
  Users DB [icon: database]
  Orders DB [icon: database]
  Payments DB [icon: database]
}
Cache [icon: cache, color: orange]

Web app, Mobile app > API Gateway: HTTPS
API Gateway > Users service, Orders service, Payments service
Users service <> Users DB
Orders service <> Orders DB
Payments service <> Payments DB
API Gateway > Cache [style: dashed]: sessions
Orders service > Payments service: charge`,
  },
  {
    id: 'cicd-pipeline',
    name: 'CI/CD pipeline',
    description: 'A push runs build and tests, publishes an image, and deploys to staging and then production.',
    type: 'architecture',
    code: `title CI/CD pipeline
direction right

Developer [icon: user]
Repository [icon: git-branch, color: gray]
CI [icon: settings, color: blue] {
  Build [icon: code]
  Unit tests [icon: check]
  Security scan [icon: shield]
}
Registry [icon: container, color: purple, description: "Versioned images"]
Staging [icon: cluster, color: orange]
Production [icon: cluster, color: green]
Monitoring [icon: chart]

Developer > Repository: git push
Repository > Build: webhook
Build > Unit tests > Security scan
Security scan > Registry: push image
Registry > Staging: deploy
Staging > Production: approve and promote
Production > Monitoring [style: dashed]: metrics`,
  },
  {
    id: 'three-tier',
    name: 'Three-tier web app',
    description: 'Presentation, application, and data tiers behind a CDN and load balancer.',
    type: 'architecture',
    code: `title Three-tier web app
direction right

User [icon: user]
CDN [icon: cache, color: orange]
Presentation tier [color: blue] {
  Load balancer [icon: load-balancer]
  Web server [icon: globe]
}
Application tier [color: purple] {
  App server 1 [icon: server]
  App server 2 [icon: server]
}
Data tier [color: green] {
  Primary DB [icon: database]
  Read replica [icon: database]
}

User > CDN: static assets
User > Load balancer: HTTPS
Load balancer > Web server
Web server > App server 1, App server 2
App server 1, App server 2 > Primary DB: writes
App server 1, App server 2 > Read replica: reads
Primary DB > Read replica [style: dashed]: replication`,
  },
  {
    id: 'event-driven',
    name: 'Event-driven with queue',
    description: 'Producers publish events to a broker; consumers process them independently, with a dead-letter queue.',
    type: 'architecture',
    code: `title Event-driven processing
direction right

Checkout service [icon: server, color: blue]
Inventory service [icon: server, color: blue]
Broker [icon: stream, color: purple] {
  Order events [icon: queue]
  Dead letters [icon: queue, color: red]
}
Consumers [color: green] {
  Email worker [icon: mail]
  Fulfilment worker [icon: function]
  Analytics worker [icon: chart]
}
Warehouse DB [icon: database]
Alerts [icon: bell, color: red]

Checkout service, Inventory service > Order events: publish
Order events > Email worker, Fulfilment worker, Analytics worker: subscribe
Fulfilment worker > Warehouse DB
Fulfilment worker > Dead letters [style: dashed]: on failure
Dead letters > Alerts`,
  },
  {
    id: 'oauth-flow',
    name: 'OAuth 2.0 login flow',
    description: 'Authorization code flow with PKCE between a browser, an app, an identity provider, and an API.',
    type: 'sequence',
    code: `title OAuth 2.0 authorization code flow
autoNumber on
User [icon: user]
App [icon: globe, color: blue]
Identity provider [icon: lock, color: purple]
API [icon: gateway, color: green]

User > App: Sign in
App --> User: Redirect to identity provider with code challenge
User > Identity provider: Log in and consent
alt [label: approved] {
  Identity provider --> App: Redirect with authorization code
  App > Identity provider: Exchange code and verifier for tokens
  activate Identity provider
  Identity provider --> App: Access and refresh tokens
  deactivate Identity provider
  App > API: Request with bearer token
  API --> App: Protected data
  App --> User: Signed in
}
else [label: denied] {
  Identity provider --> App: Error access_denied
  App --> User: Sign-in cancelled
}`,
  },
  {
    id: 'blog-erd',
    name: 'Blog database (ERD)',
    description: 'Users write posts, posts have comments and tags.',
    type: 'erd',
    code: `title Blog
users [icon: user, color: blue] {
  id uuid pk
  email string unique
  name string
  created_at timestamp
}
posts [icon: file, color: green] {
  id uuid pk
  author_id uuid fk
  title string
  slug string unique
  body text
  published_at timestamp
}
comments [icon: message, color: orange] {
  id uuid pk
  post_id uuid fk
  author_id uuid fk
  body text
  created_at timestamp
}
tags [color: purple] {
  id uuid pk
  name string unique
}
post_tags {
  post_id uuid fk
  tag_id uuid fk
}
posts.author_id > users.id: written by
comments.post_id > posts.id: on
comments.author_id > users.id: written by
post_tags.post_id > posts.id
post_tags.tag_id > tags.id`,
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
