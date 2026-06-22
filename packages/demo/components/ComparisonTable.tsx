import { ADAPTERS } from "@/lib/adapters";
import type { AdapterName } from "@/lib/constants";

interface Props {
  currentAdapter: AdapterName;
}

const INSTRUCTIONS = [
  { sig: "deposit(amount, minSharesOut)", desc: "Deposit underlying tokens into the yield source" },
  { sig: "currentValue()", desc: "Query the current value of a user position" },
  { sig: "withdraw(shares, minUnderlyingOut)", desc: "Withdraw underlying tokens from the yield source" },
];

export default function ComparisonTable({ currentAdapter }: Props) {
  return (
    <section className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-4">
      <h3 className="mb-3 text-sm font-semibold">Standard Interface — All Adapters</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a2d35]">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted">
                Instruction
              </th>
              {ADAPTERS.map((a) => (
                <th
                  key={a.name}
                  className={`px-3 py-2 text-left text-xs font-semibold uppercase text-muted ${
                    a.name === currentAdapter ? "bg-accent/5" : ""
                  }`}
                >
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {INSTRUCTIONS.map((inst) => (
              <tr key={inst.sig} className="border-b border-[#2a2d35]/50">
                <td className="px-3 py-2.5">
                  <code className="text-xs">{inst.sig}</code>
                  <p className="mt-0.5 text-[11px] text-muted">{inst.desc}</p>
                </td>
                {ADAPTERS.map((a) => (
                  <td
                    key={a.name}
                    className={`px-3 py-2.5 ${
                      a.name === currentAdapter ? "bg-accent/5" : ""
                    }`}
                  >
                    <span className="text-[#2ecc71]">✓</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted leading-relaxed">
        Every adapter implements the exact same three instructions with identical signatures.
        Protocol-specific logic is encapsulated inside each adapter program behind the standard interface.
      </p>
    </section>
  );
}
