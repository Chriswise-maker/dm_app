console.log('Testing imports...');
console.log('Importing dotenv...');
import "dotenv/config";
console.log('Importing express...');
import express from "express";
console.log('Importing trpc...');
import { createExpressMiddleware } from "@trpc/server/adapters/express";
console.log('Importing oauth...');
import { registerOAuthRoutes } from "./server/_core/oauth";
console.log('Importing routers...');
import { appRouter } from "./server/routers";
console.log('Importing context...');
import { createContext } from "./server/_core/context";
console.log('Importing vite...');
import { serveStatic, setupVite } from "./server/_core/vite";
console.log('All imports done!');

