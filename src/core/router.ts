/**
 * Event Router
 * 
 * Routes events to appropriate queues based on event type and registered handlers.
 * This ensures messages are delivered to nodes that can handle them, avoiding
 * the round-robin distribution problem where nodes receive messages they can't handle.
 */

import type { CoreDatabase, CoreLogger } from "./types.ts";
import { sanitizeIdentifier } from "./utils.ts";

export interface RouteConfig {
  eventType: string;
  targetQueue: string;
  nodeIds: string[];
}

export class EventRouter {
  private routes: Map<string, RouteConfig> = new Map();

  constructor(
    private readonly db: CoreDatabase,
    private readonly logger: CoreLogger
  ) {}

  /**
   * Register a route for an event type
   */
  async registerRoute(eventType: string, nodeId: string, queueName: string): Promise<void> {
    const existing = this.routes.get(eventType);
    if (existing) {
      if (!existing.nodeIds.includes(nodeId)) {
        existing.nodeIds.push(nodeId);
        this.logger.debug("Added node to route", { eventType, nodeId, queueName });
      }
    } else {
      this.routes.set(eventType, {
        eventType,
        targetQueue: queueName,
        nodeIds: [nodeId]
      });
      this.logger.info("Registered route", { eventType, nodeId, queueName });
    }
  }

  /**
   * Unregister a route for an event type
   */
  async unregisterRoute(eventType: string, nodeId: string): Promise<void> {
    const route = this.routes.get(eventType);
    if (route) {
      route.nodeIds = route.nodeIds.filter(id => id !== nodeId);
      if (route.nodeIds.length === 0) {
        this.routes.delete(eventType);
        this.logger.info("Removed route (no nodes)", { eventType });
      } else {
        this.logger.debug("Removed node from route", { eventType, nodeId });
      }
    }
  }

  /**
   * Route an event to the appropriate queue(s)
   * Returns the queue names the event was routed to
   */
  async routeEvent(
    eventType: string,
    envelope: unknown,
    namespace: string
  ): Promise<string[]> {
    const route = this.routes.get(eventType);
    if (!route) {
      // No route found - use default queue (current behavior)
      const defaultQueue = `core_events_${sanitizeIdentifier(namespace)}`;
      this.logger.warn("No route found for event type, using default queue", {
        eventType,
        defaultQueue
      });
      return [defaultQueue];
    }

    // Route to the target queue
    const queueName = route.targetQueue;
    await this.db.query(
      `SELECT pgmq.send($1, $2::jsonb)`,
      [queueName, envelope]
    );

    this.logger.debug("Routed event", {
      eventType,
      queueName,
      nodeCount: route.nodeIds.length
    });

    return [queueName];
  }

  /**
   * Get all routes for an event type
   */
  getRoutes(eventType: string): RouteConfig | undefined {
    return this.routes.get(eventType);
  }

  /**
   * Get all registered routes
   */
  getAllRoutes(): RouteConfig[] {
    return Array.from(this.routes.values());
  }
}

