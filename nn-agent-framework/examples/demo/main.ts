// In your own project this import is: import { runCli } from "nn-agent-framework";
import { runCli } from "../../src/index.js";
import { demoWorkflow } from "./workflow.js";

runCli({ [demoWorkflow.name]: demoWorkflow });
