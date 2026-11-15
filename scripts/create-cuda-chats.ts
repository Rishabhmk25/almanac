interface ChatResponse {
  id: string;
  conversationId: string;
  text: string;
  evidence: Array<{ ref: string; title: string; kind: string }>;
  flags: Array<{ id: string; reason: string }>;
  trace: Array<{ stage: string; ms: number }>;
}

async function sendChat(message: string, conversationId: string | null = null): Promise<ChatResponse> {
  const url = 'http://127.0.0.1:3000/api/chat?stream=0';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: '127.0.0.1:3000',
      Origin: 'http://127.0.0.1:3000',
    },
    body: JSON.stringify({
      conversationId,
      message,
      tz: 'Asia/Kolkata',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API error HTTP ${res.status}: ${errText}`);
  }

  return (await res.json()) as ChatResponse;
}

const conversationsToRun = [
  {
    name: 'Chat 1: Introduction to CUDA and GPU Architecture',
    prompts: [
      'What is CUDA, how does the GPU streaming multiprocessor architecture differ from the CPU, and when should I use it for parallel compute?',
    ],
  },
  {
    name: 'Chat 2: Writing CUDA Kernels and Thread Hierarchy',
    prompts: [
      'Can you explain how the CUDA thread hierarchy works with threads, blocks, grids, and warps? Please show a complete vector addition kernel example in C++ with launch configuration.',
      'How does 2D thread indexing work when mapping threadIdx and blockIdx to a matrix?',
    ],
  },
  {
    name: 'Chat 3: CUDA Memory Hierarchy and Shared Memory Tiling',
    prompts: [
      'What are the different types of memory in CUDA (registers, shared memory, global memory, constant memory), and how does shared memory tiling optimize matrix multiplication?',
      'How do CUDA streams and cudaMemcpyAsync allow overlapping kernel execution with memory transfers?',
    ],
  },
  {
    name: 'Chat 4: CUDA Memory Management: Unified vs Pinned Host Memory',
    prompts: [
      'What is the difference between standard pageable host memory, pinned memory with cudaHostAlloc, and unified memory with cudaMallocManaged? When should I use each?',
    ],
  },
];

async function main() {
  console.log('=== Starting Real HTTP Chat Creation Through /api/chat ===\n');

  for (const conv of conversationsToRun) {
    console.log(`\n======================================================`);
    console.log(`▶ Starting ${conv.name}`);
    console.log(`======================================================`);

    let convId: string | null = null;

    for (let i = 0; i < conv.prompts.length; i++) {
      const prompt = conv.prompts[i];
      console.log(`\n[Turn ${i + 1}/${conv.prompts.length}] User: "${prompt}"`);
      const t0 = Date.now();

      try {
        const response = await sendChat(prompt, convId);
        convId = response.conversationId;
        const elapsed = Math.round((Date.now() - t0) / 1000);

        console.log(`✓ Answer received (${elapsed}s, convId: ${convId}):`);
        console.log(`  Trace: ${response.trace.map(t => `${t.stage} ${Math.round(t.ms)}ms`).join(' · ')}`);
        console.log(`  Evidence items: ${response.evidence.length}`);
        console.log(`  Preview: ${response.text.slice(0, 150).replace(/\n/g, ' ')}...\n`);
      } catch (err: any) {
        console.error(`✗ Error on turn ${i + 1}:`, err.message);
      }
    }
  }

  console.log('\n=== All 4 CUDA Conversations Created Successfully! ===');
}

main().catch(console.error);
