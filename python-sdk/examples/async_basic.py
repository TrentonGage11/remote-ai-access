import asyncio

from remote_ai_access import AsyncRemoteAIAccessClient


async def main() -> None:
    async with AsyncRemoteAIAccessClient(
        base_url="https://ai.tg11.org",
        api_key="YOUR_API_KEY",
        workspace_code="default",
        max_retries=3,
    ) as client:
        cfg = await client.config_typed()
        print("default model:", cfg.default_model)

        reply = await client.chat_typed(
            messages=[{"role": "user", "content": "hello from async sdk"}],
            agent_mode=False,
        )
        print("provider:", reply.provider)
        print("reply:", reply.reply[:120])


if __name__ == "__main__":
    asyncio.run(main())
