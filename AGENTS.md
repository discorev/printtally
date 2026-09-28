# Print Tally

Print tally is an application to help track the costs associated with printing. Inspired by first party print accounting software, it accounts the cost of prints in a durable ledger covering the ink usage, paper, and more over time.

## Why use Print Tally over first-party software?

The first party software for Canon imagePROGRAF printers does not yet support macOS 27. It also has some rough edges - You cannot label a job to help you come back to it later, you cannot change the paper used because you printed with a stock profile but actually were using a test-pack. You cannot hide the jobs that you don't care about.

The aim of this software is to give a better experience to users.

### 1. Give users choice and flexibility

A durable print log is the core of the tool, but being able to correct the paper used, add a note, etc. are where the real value is.

### 2. Multi-surface

Print tally has two key surfaces, **web** and **desktop**, and they matter equally.
Every new feature must work on both.

**Web** is two surfaces in one: running `bunx printtally` starts the server locally and opens the UI in the browser, and the same server can serve the UI to browsers on other devices (for example from a machine that stays near the printer).

**Desktop** is a full Electron app that bundles the server and loads the same UI.
The desktop can either connect to a local backend that starts when you run it, or a remote machine (the one next to the printer).
