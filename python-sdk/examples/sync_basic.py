from remote_ai_access import RemoteAIAccessClient


def main() -> None:
    client = RemoteAIAccessClient(
        base_url="https://ai.tg11.org",
        api_key="YOUR_API_KEY",
        workspace_code="default",
        max_retries=3,
    )

    cfg = client.config_typed()
    print("default model:", cfg.default_model)
    print("api key header:", cfg.api_key_auth.header_name)

    listing = client.files_list_typed("src")
    print("entries in src:", len(listing.entries))


if __name__ == "__main__":
    main()
