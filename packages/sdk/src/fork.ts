import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const PROJECT_DIR = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = path.join(PROJECT_DIR, "tests", "fixtures");
const VALIDATOR_DIR = path.join(PROJECT_DIR, "test-ledger");
const DEPLOY_DIR = path.join(PROJECT_DIR, "target", "deploy");

interface CloneSpec {
  label: string;
  address: string;
}

const CLONE_SPECS: CloneSpec[] = [
  { label: "Kamino K-Lend", address: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD" },
  { label: "MarginFi v2", address: "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA" },
  { label: "Jupiter Perps", address: "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu" },
  { label: "Drift v2", address: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH" },
  { label: "USDC Mint", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { label: "syrupUSDC Mint", address: "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj" },
  { label: "ATA Program", address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" },
];

function step(n: number, total: number, label: string): void {
  console.log(`\n[${n}/${total}] ${label}...`);
}

function run(
  cmd: string,
  opts?: { cwd?: string; maxBuffer?: number }
): string {
  return execSync(cmd, {
    cwd: opts?.cwd ?? PROJECT_DIR,
    stdio: "pipe",
    encoding: "utf-8",
    maxBuffer: opts?.maxBuffer ?? 10 * 1024 * 1024,
  });
}

function waitForValidator(
  url: string,
  maxRetries = 60,
  interval = 2000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      try {
        execSync(`solana cluster-version -u ${url}`, {
          stdio: "pipe",
          encoding: "utf-8",
        });
        resolve();
      } catch {
        retries++;
        if (retries >= maxRetries) {
          reject(new Error(`Validator not ready after ${maxRetries}s`));
        } else {
          setTimeout(check, interval);
        }
      }
    };
    check();
  });
}

export async function startValidator(): Promise<string> {
  const url = "http://127.0.0.1:8899";

  fs.mkdirSync(VALIDATOR_DIR, { recursive: true });

  const args: string[] = [
    "--reset",
    "--ledger",
    VALIDATOR_DIR,
    "--url",
    "mainnet-beta",
    "--quiet",
  ];

  for (const spec of CLONE_SPECS) {
    args.push("--clone", spec.address);
  }

  const fixtureAta = path.join(FIXTURE_DIR, "fork-usdc-ata.json");
  if (fs.existsSync(fixtureAta)) {
    const fixture = JSON.parse(fs.readFileSync(fixtureAta, "utf-8"));
    args.push("--account", fixture.pubkey, fixtureAta);
    console.log(`  Injected USDC fixture ATA: ${fixture.pubkey}`);
  }

  const fixtureSyrupAta = path.join(FIXTURE_DIR, "fork-syrup-usdc-ata.json");
  if (fs.existsSync(fixtureSyrupAta)) {
    const fixture = JSON.parse(fs.readFileSync(fixtureSyrupAta, "utf-8"));
    args.push("--account", fixture.pubkey, fixtureSyrupAta);
    console.log(`  Injected syrupUSDC fixture ATA: ${fixture.pubkey}`);
  }

  const { spawn } = await import("child_process");
  const proc = spawn("solana-test-validator", args, {
    cwd: PROJECT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (d: Buffer) => {
    const text = d.toString();
    if (!text.includes("leader")) process.stdout.write(text);
  });

  proc.stderr?.on("data", (d: Buffer) => {
    const text = d.toString();
    if (text.includes("Error") || text.includes("error")) {
      process.stderr.write(text);
    }
  });

  const pidPath = path.join(VALIDATOR_DIR, "validator.pid");
  fs.writeFileSync(pidPath, String(proc.pid));
  console.log(`  Validator PID: ${proc.pid}`);

  console.log("  Waiting for validator...");
  await waitForValidator(url);
  console.log("  Validator ready.");

  return url;
}

export function deployPrograms(): void {
  const sos = fs
    .readdirSync(DEPLOY_DIR)
    .filter((f) => f.endsWith(".so"))
    .sort();

  for (const soFile of sos) {
    const base = soFile.replace(/\.so$/, "");
    const keypair = path.join(DEPLOY_DIR, `${base}-keypair.json`);

    if (!fs.existsSync(keypair)) {
      console.log(`  SKIP ${base}: missing keypair`);
      continue;
    }

    const so = path.join(DEPLOY_DIR, soFile);
    console.log(`  Deploying ${base}...`);
    run(
      `solana program deploy ${so} --program-id ${keypair} -u http://127.0.0.1:8899`
    );
    console.log(`    ${base} deployed.`);
  }
}

export function runTests(): void {
  execSync(
    "anchor test --skip-local-validator --skip-build --validator legacy --provider.cluster localnet",
    {
      cwd: PROJECT_DIR,
      stdio: "inherit",
      encoding: "utf-8",
      timeout: 300000,
    }
  );
}

export function cleanupValidator(): void {
  console.log("\nCleaning up test validator...");

  const pidPath = path.join(VALIDATOR_DIR, "validator.pid");
  if (fs.existsSync(pidPath)) {
    try {
      const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);
      try {
        process.kill(pid, "SIGKILL");
        console.log(`  Killed validator PID ${pid}`);
      } catch {}
      fs.unlinkSync(pidPath);
    } catch {}
  }

  try {
    execSync("pkill -f solana-test-validator", { stdio: "pipe" });
  } catch {}
}

export async function prepareFixtures(): Promise<void> {
  run("bash scripts/setup-fork-usdc-fixture.sh");
  run("bash scripts/setup-fork-syrup-usdc-fixture.sh");
}

export async function buildPrograms(): Promise<void> {
  fs.chmodSync(path.join(PROJECT_DIR, "scripts", "build-sbf.sh"), 0o755);
  fs.chmodSync(path.join(PROJECT_DIR, "scripts", "build-idls.sh"), 0o755);
  run("bash scripts/build-sbf.sh");
  run("bash scripts/build-idls.sh");
}
