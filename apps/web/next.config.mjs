/** @type {import('next').NextConfig} */
const nextConfig = {
	transpilePackages: ['@proofads/shared', '@proofads/sdk', '@proofads/ens-client'],
	reactStrictMode: true,
}
export default nextConfig
