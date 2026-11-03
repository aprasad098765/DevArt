// DevArt's own stroke icon set, drawn on a 24x24 grid. Vendor terms map to generic glyphs, not vendor logos.
const P: Record<string, string> = {
  server: 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01',
  database: 'M4 6c0-4 16-4 16 0v12c0 4-16 4-16 0zM4 6c0 4 16 4 16 0M4 12c0 4 16 4 16 0',
  cloud: 'M7 19a5 5 0 0 1-.6-10A6.5 6.5 0 0 1 19 10a4.5 4.5 0 0 1-1 9z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-5 4-7 8-7s7 2 8 7',
  users: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c.8-5 3.4-7 7-7s6.200 2 7 7M16 4.500a4 4 0 0 1 0 7M18 14.500c2 .8 3.400 2.800 4 6.500',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  key: 'M8 21a5 5 0 1 1 3.500-8.500L20 4l2 2-2 2 2 2-3 3-2-2-3.500 3.500A5 5 0 0 1 8 21z',
  queue: 'M4 6h16M4 12h16M4 18h16M2 6h.01M2 12h.01M2 18h.01',
  bucket: 'M4 6h16l-2 15H6zM4 6c0-3 16-3 16 0',
  function: 'M6 20c3 0 4-2 5-8s2-8 5-8M7 11h9M14 15l5 5M19 15l-5 5',
  container: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  cluster: 'M12 2l9 5v10l-9 5-9-5V7zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  gateway: 'M3 12h6M15 12h6M9 6h6v12H9zM18 9l3 3-3 3M6 9l-3 3 3 3',
  'load-balancer': 'M12 3v6M12 9L5 15M12 9v6M12 9l7 6M9 3h6M3 15h4v5H3zM10 15h4v5h-4zM17 15h4v5h-4z',
  cache: 'M13 2L4 14h7l-1 8 9-12h-7z',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  phone: 'M7 2h10v20H7zM11 18h2',
  laptop: 'M5 4h14v11H5zM2 19h20l-3-4H5z',
  monitor: 'M3 4h18v12H3zM9 21h6M12 16v5',
  file: 'M6 2h8l5 5v15H6zM14 2v5h5',
  folder: 'M3 6h6l2 3h10v11H3z',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  terminal: 'M3 4h18v16H3zM7 9l3 3-3 3M12 16h5',
  'git-branch': 'M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9c0 5-6 4-12 7',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  shield: 'M12 2l8 3v7c0 5-3.500 8-8 10-4.500-2-8-5-8-10V5z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  bell: 'M6 16V10a6 6 0 0 1 12 0v6l2 3H4zM10 22h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  network: 'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 9v3M6 16l6-4 6 4',
  cpu: 'M6 6h12v12H6zM10 10h4v4h-4zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
  disk: 'M3 13l3-9h12l3 9v7H3zM3 13h18M7 17h.01',
  message: 'M3 4h18v13H8l-5 4z',
  card: 'M2 5h20v14H2zM2 10h20M6 15h4',
  calendar: 'M3 5h18v16H3zM3 10h18M8 2v5M16 2v5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3',
  check: 'M4 12l5 5L20 6',
  x: 'M5 5l14 14M19 5L5 19',
  star: 'M12 3l3 6 6 1-4.500 4.500L18 21l-6-3-6 3 1.500-6.500L3 10l6-1z',
  heart: 'M12 21C5 15 2 12 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 4-3 7-10 13z',
  home: 'M3 11l9-8 9 8M5 10v11h14V10M10 21v-6h4v6',
  pin: 'M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  link: 'M10 14a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l1-1',
  wifi: 'M2 9c6-5 14-5 20 0M6 13c4-3 8-3 12 0M10 17c1.500-1 2.500-1 4 0M12 20h.01',
  stream: 'M3 7c3-3 6 3 9 0s6 3 9 0M3 12c3-3 6 3 9 0s6 3 9 0M3 17c3-3 6 3 9 0s6 3 9 0',
  firewall: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v5M15 10v5M9 15v4',
  dns: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 9v6M16 9v6M8 12h8',
};

const ALIASES: Record<string, string> = {
  ec2: 'server', vm: 'server', compute: 'server', instance: 'server', 'compute-engine': 'server',
  s3: 'bucket', storage: 'bucket', blob: 'bucket', gcs: 'bucket',
  rds: 'database', db: 'database', postgres: 'database', postgresql: 'database', mysql: 'database',
  dynamodb: 'database', mongodb: 'database', sql: 'database',
  redis: 'cache', elasticache: 'cache', memcached: 'cache', cdn: 'cache', cloudfront: 'cache',
  lambda: 'function', 'cloud-functions': 'function', faas: 'function',
  docker: 'container', ecs: 'container', pod: 'container',
  k8s: 'cluster', kubernetes: 'cluster', eks: 'cluster', gke: 'cluster', aks: 'cluster',
  sqs: 'queue', rabbitmq: 'queue', mq: 'queue', sns: 'bell', kafka: 'stream', kinesis: 'stream',
  alb: 'load-balancer', elb: 'load-balancer', lb: 'load-balancer', nginx: 'load-balancer',
  'api-gateway': 'gateway', api: 'gateway', router: 'gateway', vpc: 'network', subnet: 'network',
  route53: 'dns', waf: 'firewall', iam: 'key', kms: 'key', auth: 'lock',
  aws: 'cloud', azure: 'cloud', gcp: 'cloud', 'google-cloud': 'cloud',
  web: 'globe', browser: 'globe', internet: 'globe', mobile: 'phone', desktop: 'monitor',
  person: 'user', customer: 'user', team: 'users', github: 'git-branch', git: 'git-branch', gitlab: 'git-branch',
  email: 'mail', payment: 'card', stripe: 'card', metrics: 'chart', monitoring: 'chart', logs: 'file', document: 'file',
};

export const ICON_NAMES = Object.keys(P).sort();
export const ICON_ALIASES = ALIASES;

export function iconPath(name: string | undefined): string | null {
  if (!name) return null;
  const k = name.toLowerCase().trim();
  return P[k] ?? P[ALIASES[k]] ?? null;
}
