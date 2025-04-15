"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const worker_threads_1 = require("worker_threads"); // Use Worker threads
const cors_1 = __importDefault(require("cors"));
const axios_1 = __importDefault(require("axios"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
const port = 3001;
app.use(body_parser_1.default.json());
app.post('/submit-code', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { userId, problemId, code, language } = req.body;
    let success = true;
    let error = null;
    try {
        if (!code) {
            return res.status(400).json({ error: 'Missing code.' });
        }
        if (language !== 'JAVASCRIPT') {
            return res.status(400).json({ error: 'Unsupported language.' });
        }
        const newRes = yield axios_1.default.get(`${process.env.BACKEND}/api/routes/getTestCases?problemId=${problemId}`);
        if (!newRes.data.testCases) {
            return res.status(400).json({ error: 'Missing test cases.' });
        }
        const testCases = newRes.data.testCases;
        const results = yield runCodeInWorker(code, testCases);
        for (let i = 0; i < results.length; i++) {
            if (!results[i].passed) {
                success = false;
                error = results[i].error;
                break;
            }
        }
        const correctCode = code.toString();
        yield axios_1.default.post('http://localhost:3000/api/routes/submission', {
            userId,
            problemId,
            code: correctCode,
            language,
            solved: success,
            status: success ? "ACCEPTED" : (error ? error : "WRONG_ANSWER")
        });
        if (error) {
            return res.json({ success, results, error });
        }
        else {
            if (success) {
                return res.json({ success, results });
            }
            return res.json({ success, results, error: "Wrong Answer" });
        }
    }
    catch (error) {
        console.error('Error running code:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}));
function runCodeInWorker(code, testCases) {
    return new Promise((resolve) => {
        const worker = new worker_threads_1.Worker(`
      const { parentPort } = require('worker_threads');

      parentPort.on('message', async ({ code, testCases }) => {
        try {
          const dynamicFunction = eval('(' + code + ')');
          const results = [];
          
          for (let i = 0; i < testCases.length; i++) {
            const { input, output } = testCases[i];
            const expectedOutput = output.output;
            try {
              const inputValues = Object.values(input);
              const result = dynamicFunction(...inputValues);
              const passed = JSON.stringify(result) === JSON.stringify(output.output);
              results.push({ testCase: i + 1, passed, result, expectedOutput });
            } catch (err) {
              results.push({ testCase: i + 1, passed: false, error: err.message, expectedOutput });
            }
          }
          parentPort.postMessage({ results });
        } catch (err) {
          parentPort.postMessage({ error: err.message });
        }
      });
    `, { eval: true });
        // Listen for results from the worker
        worker.on('message', (message) => {
            if (message.results) {
                resolve(message.results);
            }
            else {
                resolve(testCases.map((testCase, i) => ({
                    testCase: i + 1,
                    passed: false,
                    error: message.error || 'Unknown error',
                    expectedOutput: testCase.output.output
                })));
            }
            worker.terminate(); // Terminate the worker after processing
        });
        // Handle worker errors
        worker.on('error', (err) => {
            console.error('Worker error:', err);
            resolve(testCases.map((testCase, i) => ({
                testCase: i + 1,
                passed: false,
                error: 'Worker thread error',
                expectedOutput: testCase.output.output
            })));
            worker.terminate(); // Ensure the worker is terminated
        });
        // Enforce timeout by killing the worker
        setTimeout(() => {
            worker.terminate();
            resolve(testCases.map((testCase, i) => ({
                testCase: i + 1,
                passed: false,
                error: 'TLE',
                expectedOutput: testCase.output.output
            })));
        }, 1000); // Timeout set to 1 second
        // Send code and test cases to the worker
        worker.postMessage({ code, testCases });
    });
}
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
