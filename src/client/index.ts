/**
 * nexus-core Client SDK
 * 
 * Simple API for applications to interact with nexus-core infrastructure.
 * Abstracts away routing complexity and communicates with nexus-core workers.
 */

import type { EventEnvelope, EventHandler, EventContext } from "../core/types.ts";

export interface ClientOptions {
  /** nexus-core worker API endpoint (for API mode) */
  nexusCoreEndpoint?: string;
  
  /** Direct database connection (for queue mode) */
  databaseUrl?: string;
  
  /** Worker identification */
  workerId?: string;
  
  /** Namespace */
  namespace?: string;
  
  /** Communication mode */
  mode?: "api" | "queue";
  
  /** Logger */
  logger?: ClientLogger;
}

export interface ClientLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  error(error: Error, meta?: Record<string, unknown>): void;
}

export interface NodeConfig {
  nodeId?: string;
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface EmitOptions {
  broadcast?: boolean;
}

/**
 * nexus-core Client SDK
 * 
 * Provides a simple API for applications to emit events and register handlers.
 * Communicates with nexus-core workers (infrastructure layer) to handle routing.
 */
export class NexusCoreClient {
  private connected = false;
  private workerId: string;
  private namespace: string;
  private mode: "api" | "queue";
  private apiClient?: ApiClient;
  private db?: unknown; // CoreDatabase type
  private router?: unknown; // MultiWorkerRouter type

  constructor(private readonly options: ClientOptions) {
    this.workerId = options.workerId ?? this.generateWorkerId();
    this.namespace = options.namespace ?? "default";
    this.mode = options.mode ?? (options.nexusCoreEndpoint ? "api" : "queue");
  }

  /**
   * Connect to nexus-core infrastructure
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.mode === "api") {
      if (!this.options.nexusCoreEndpoint) {
        throw new Error("nexusCoreEndpoint required for API mode");
      }
      this.apiClient = new ApiClient(this.options.nexusCoreEndpoint);
      
      // Register worker with nexus-core
      await this.apiClient.post(`/api/v1/workers/${this.workerId}/register`, {
        namespace: this.namespace,
        capabilities: []
      });
    } else {
      // Queue mode - direct database access
      if (!this.options.databaseUrl) {
        throw new Error("databaseUrl required for queue mode");
      }
      // Initialize database connection and router
      // (Implementation details)
    }

    this.connected = true;
  }

  /**
   * Create a node (represents an application component)
   */
  async createNode(config?: NodeConfig): Promise<Node> {
    if (!this.connected) {
      throw new Error("Client not connected. Call connect() first.");
    }

    const nodeId = config?.nodeId ?? this.generateNodeId();

    if (this.mode === "api") {
      // Register node with nexus-core
      await this.apiClient!.post(`/api/v1/workers/${this.workerId}/nodes`, {
        nodeId,
        displayName: config?.displayName,
        description: config?.description,
        metadata: config?.metadata ?? {}
      });
    }

    return new Node(
      this.apiClient,
      this.workerId,
      nodeId,
      this.namespace,
      this.mode
    );
  }

  /**
   * Disconnect from nexus-core infrastructure
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    if (this.mode === "api") {
      // Deregister worker
      await this.apiClient!.delete(`/api/v1/workers/${this.workerId}`);
    }

    this.connected = false;
  }

  private generateWorkerId(): string {
    return `worker-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private generateNodeId(): string {
    return `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

/**
 * Node - represents an application component
 * 
 * Provides simple API for emitting events and registering handlers.
 */
export class Node {
  private handlers = new Map<string, Set<EventHandler>>();
  private consuming = false;
  private queues: string[] = [];

  constructor(
    private readonly apiClient: ApiClient | undefined,
    private readonly workerId: string,
    private readonly nodeId: string,
    private readonly namespace: string,
    private readonly mode: "api" | "queue"
  ) {}

  /**
   * Emit an event
   * 
   * Automatically routed by nexus-core workers to appropriate handlers.
   */
  async emit<TPayload = unknown>(
    eventType: string,
    payload: TPayload,
    options?: EmitOptions
  ): Promise<number> {
    const envelope: EventEnvelope = {
      namespace: this.namespace,
      eventType,
      payload,
      emittedAt: new Date().toISOString(),
      producerNodeId: this.nodeId,
      broadcast: options?.broadcast ?? false
    };

    if (this.mode === "api") {
      // Send to nexus-core router via API
      const response = await this.apiClient!.post<{ routedQueues: string[] }>(
        "/api/v1/events/route",
        envelope
      );
      return response.routedQueues.length;
    } else {
      // Queue mode - send to router queue
      // (Implementation would use database directly)
      return 1;
    }
  }

  /**
   * Register an event handler
   * 
   * Automatically registered with nexus-core workers.
   * Handler will receive events routed to this worker.
   */
  onEvent<TPayload = unknown>(
    eventType: string,
    handler: EventHandler<TPayload>
  ): void {
    const handlers = this.handlers.get(eventType) ?? new Set();
    handlers.add(handler as EventHandler);
    this.handlers.set(eventType, handlers);

    if (this.mode === "api") {
      // Register subscription with nexus-core
      this.apiClient!.post(`/api/v1/workers/${this.workerId}/subscribe`, {
        eventTypes: [eventType]
      }).catch((error) => {
        console.error("Failed to register subscription:", error);
      });
    }

    // Start consuming if not already started
    if (!this.consuming) {
      this.startConsuming();
    }
  }

  /**
   * Unregister an event handler
   */
  offEvent(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(eventType);
      }
    }
  }

  /**
   * Start the node (begin consuming events)
   */
  async start(): Promise<void> {
    await this.startConsuming();
  }

  /**
   * Stop the node (stop consuming events)
   */
  async stop(): Promise<void> {
    this.consuming = false;
  }

  private async startConsuming(): Promise<void> {
    if (this.consuming) {
      return;
    }

    this.consuming = true;

    if (this.mode === "api") {
      // Get queues for this worker from nexus-core
      const response = await this.apiClient!.get<{ queues: string[] }>(
        `/api/v1/workers/${this.workerId}/queues`
      );
      this.queues = response.queues;
    } else {
      // Queue mode - get queues from router
      // (Implementation would use router directly)
    }

    // Start consuming from queues
    // (Implementation would start consumer loop)
  }
}

/**
 * Simple HTTP API client for communicating with nexus-core workers
 */
class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async delete(path: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }
  }
}

