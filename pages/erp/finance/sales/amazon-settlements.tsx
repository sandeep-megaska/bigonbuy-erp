import type { GetServerSideProps } from "next";

const LegacyAmazonSettlementsRoute = () => null;

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: "/erp/finance/amazon/settlement-posting",
    permanent: false,
  },
});

export default LegacyAmazonSettlementsRoute;
